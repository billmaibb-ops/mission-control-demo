/**
 * FleetPlugin — teaches Open MCT about our vehicle fleet.
 *
 * Three parts (this is the pattern every Open MCT integration follows):
 *   1. Object provider     — "what things exist?" (fleet > vehicles > channels)
 *   2. Historical provider — "give me past data" (REST call to /telemetry/...)
 *   3. Realtime provider   — "stream me new data" (WebSocket /realtime)
 */
function DronePlugin() {
  const NAMESPACE = 'fleet.taxonomy';
  const FLEET_KEY = 'fleet';

  return function install(openmct) {
    const dictionaryPromise = fetch('/dictionary.json').then((r) => r.json());

    function findMeasurement(dict, key) {
      for (const v of dict.vehicles) {
        const m = v.measurements.find((x) => x.key === key);
        if (m) return { vehicle: v, measurement: m };
      }
      return null;
    }

    // -----------------------------------------------------------------
    // 1. Objects: Fleet folder > vehicle folders > telemetry points
    // -----------------------------------------------------------------
    openmct.objects.addRoot({ namespace: NAMESPACE, key: FLEET_KEY });

    openmct.objects.addProvider(NAMESPACE, {
      get(identifier) {
        return dictionaryPromise.then((dict) => {
          if (identifier.key === FLEET_KEY) {
            return {
              identifier,
              name: dict.name,
              type: 'folder',
              location: 'ROOT'
            };
          }

          const vehicle = dict.vehicles.find((v) => v.key === identifier.key);
          if (vehicle) {
            return {
              identifier,
              name: vehicle.name,
              type: 'folder',
              location: NAMESPACE + ':' + FLEET_KEY
            };
          }

          const found = findMeasurement(dict, identifier.key);
          if (!found) return undefined;
          return {
            identifier,
            name: found.measurement.name,
            type: 'fleet.telemetry',
            telemetry: {
              values: [
                {
                  key: 'value',
                  name: 'Value',
                  units: found.measurement.units,
                  format: 'float',
                  min: found.measurement.min,
                  max: found.measurement.max,
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
            location: NAMESPACE + ':' + found.vehicle.key
          };
        });
      }
    });

    // Fleet folder contains the vehicles
    openmct.composition.addProvider({
      appliesTo(domainObject) {
        return (
          domainObject.identifier.namespace === NAMESPACE &&
          domainObject.identifier.key === FLEET_KEY
        );
      },
      load() {
        return dictionaryPromise.then((dict) =>
          dict.vehicles.map((v) => ({ namespace: NAMESPACE, key: v.key }))
        );
      }
    });

    // Each vehicle folder contains its telemetry points
    openmct.composition.addProvider({
      appliesTo(domainObject) {
        return (
          domainObject.identifier.namespace === NAMESPACE &&
          domainObject.identifier.key !== FLEET_KEY &&
          domainObject.type === 'folder'
        );
      },
      load(domainObject) {
        return dictionaryPromise.then((dict) => {
          const vehicle = dict.vehicles.find(
            (v) => v.key === domainObject.identifier.key
          );
          if (!vehicle) return [];
          return vehicle.measurements.map((m) => ({
            namespace: NAMESPACE,
            key: m.key
          }));
        });
      }
    });

    openmct.types.addType('fleet.telemetry', {
      name: 'Vehicle Telemetry Point',
      description: 'A live telemetry channel from a fleet vehicle',
      cssClass: 'icon-telemetry'
    });

    // -----------------------------------------------------------------
    // 2. Historical telemetry: REST
    // -----------------------------------------------------------------
    openmct.telemetry.addProvider({
      supportsRequest(domainObject) {
        return domainObject.type === 'fleet.telemetry';
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
    const listeners = {};
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
      socket.onclose = () => { openPromise = null; };
      return openPromise;
    }

    openmct.telemetry.addProvider({
      supportsSubscribe(domainObject) {
        return domainObject.type === 'fleet.telemetry';
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
