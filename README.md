# Mission Control Demo

A tiny working version of the "hosted telemetry service" idea: NASA's Open MCT
dashboard + a fake drone that streams telemetry once per second.

## Run it

You need [Node.js](https://nodejs.org) installed. Then:

```sh
cd mission-control-demo
npm install
npm start
```

Open http://localhost:8080 in your browser.

## What to try

1. In the left tree, expand **Drone Alpha** — you'll see six live channels
   (battery, altitude, speed, signal, motor temp).
2. Click any channel to see it plotted live. The time conductor at the bottom
   is in realtime mode showing the last 15 minutes.
3. Click **Create → Display Layout**, drag several channels onto it, and build
   your own mission-control screen. Layouts save automatically in the browser.

## How it maps to the real business

| This demo                    | The real SaaS                                  |
|------------------------------|------------------------------------------------|
| Fake drone simulator         | Customer devices sending data to your API/MQTT |
| In-memory history (2 hours)  | Time-series database (InfluxDB / Timescale)    |
| No login, one drone          | Accounts, billing, one workspace per customer  |
| `npm start` on your laptop   | Hosted on a cloud server with a domain + SSL   |

The file to study is `public/drone-plugin.js` — that ~150-line pattern
(objects + history + realtime) is the same one you'd use to connect any
data source to Open MCT.

## License notes

Open MCT is Apache 2.0. You may use and sell services built on it. Keep its
license/notice files intact and don't market using NASA's name or logo.
