/**
 * DronePlugin — teaches Open MCT about our drone.
 *
 * Three parts (this is the pattern every Open MCT integration follows):
 *   1. Object provider   — "what things exist?" (the drone + its channels)
 *   2. Historical provider — "give me past data" (REST call to /telemetry/...)
 *   3. Realtime provider   — "stream me new data" (WebSocket /realtime)
 */
function DronePlugin() {
  const NAMESPACE = 'drone.taxonomy';
  const DRONE_KEY = 'drone-1';

  return function install(openmct) {
    const dictionaryPromise = fetch('/dictionary.json').then((r) => r.json());

    // -----------------------------------------------------------------
    // 1. Objects: a root "Drone Alpha" folder containing one object per
    //    telemetry channel from the dictionary.
    // -----------------------------------------------------------------
    openmct.objects.addRoot({ namespace: NAMESPACE, key: DRONE_KEY });

    openmct.objects.addProvider(NAMESPACE, {
      get(identifier) {
        return dictionaryPromise.then((dict) => {
          if (identifier.key === DRONE_KEY) {
            return {
              identifier,
              name: dict.name,
              type: 'folder',
              location: 'ROOT'
            };
          }
          const m = dict.measurements.find((x) => x.key === identifier.key);
          return {
            identifier,
            name: m.name,
            type: 'drone.telemetry',
            telemetry: {
              values: [
                {
                  key: 'value',
                  name: 'Value',
                  units: m.units,
                  format: 'float',
                  min: m.min,
                  max: m.max,
                  hints: { range: 1 }
                },
                {
                  key: 'utc',
                  source: 'timestamp',
                  name: 'Timestamp',
                  format: 'utc',
                  hints: { domain: 1 }
                }
              ]
            },
            location: NAMESPACE + ':' + DRONE_KEY
          };
        });
      }
    });

    openmct.composition.addProvider({
      appliesTo(domainObject) {
        return (
          domainObject.identifier.namespace === NAMESPACE &&
          domainObject.identifier.key === DRONE_KEY
        );
      },
      load() {
        return dictionaryPromise.then((dict) =>
          dict.measurements.map((m) => ({ namespace: NAMESPACE, key: m.key }))
        );
      }
    });

    openmct.types.addType('drone.telemetry', {
      name: 'Drone Telemetry Point',
      description: 'A live telemetry channel from the drone',
      cssClass: 'icon-telemetry'
    });

    // -----------------------------------------------------------------
    // 2. Historical telemetry: REST
    // -----------------------------------------------------------------
    openmct.telemetry.addProvider({
      supportsRequest(domainObject) {
        return domainObject.type === 'drone.telemetry';
      },
      request(domainObject, options) {
        const url =
          '/telemetry/' + domainObject.identifier.key +
          '/history?start=' + Math.floor(options.start) +
          '&end=' + Math.floor(options.end);
        return fetch(url).then((r) => r.json());
      }
    });

    // -----------------------------------------------------------------
    // 3. Realtime telemetry: WebSocket
    // -----------------------------------------------------------------
    const listeners = {}; // telemetry key -> Set of callbacks
    let socket;
    let openPromise;

    function ensureSocket() {
      if (openPromise) return openPromise;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(proto + '://' + location.host + '/realtime');
      socket.onmessage = (event) => {
        const point = JSON.parse(event.data);
        (listeners[point.id] || []).forEach((cb) => cb(point));
      };
      openPromise = new Promise((resolve) => {
        socket.onopen = () => resolve(socket);
      });
      socket.onclose = () => { openPromise = null; }; // allow reconnect
      return openPromise;
    }

    openmct.telemetry.addProvider({
      supportsSubscribe(domainObject) {
        return domainObject.type === 'drone.telemetry';
      },
      subscribe(domainObject, callback) {
        const key = domainObject.identifier.key;
        if (!listeners[key]) listeners[key] = new Set();
        listeners[key].add(callback);

        ensureSocket().then((ws) =>
          ws.send(JSON.stringify({ type: 'subscribe', key }))
        );

        return function unsubscribe() {
          listeners[key].delete(callback);
          if (listeners[key].size === 0 && socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'unsubscribe', key }));
          }
        };
      }
    });
  };
}
