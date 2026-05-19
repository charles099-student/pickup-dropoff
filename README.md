# Pickup Dropoff

This is a Vite + React web application that lets a user enter one pickup address and one drop-off address, request a route, and view the route on an interactive MapLibre map.

The application uses public web services:

- Lalamove mock route API: submits the pickup/drop-off request and polls for route status.
- OpenFreeMap with MapLibre GL JS: renders the interactive map.
- OpenStreetMap Nominatim: provides address autocomplete.
- OSRM public route API: converts returned waypoints into road-following route geometry.

No map API key is required in this project.

## Requirements for using and/or testing the Web app

- Node.js `18` or newer. The installed Vite version supports Node `^18.0.0`, `^20.0.0`, or `>=22.0.0`.
- npm, which is included with Node.js.
- Git, for cloning and version control.
- Internet access, because the map, autocomplete, and route services are remote APIs.

To check your local versions:

```bash
node --version
npm --version
git --version
```

## Git Version Control

Repository URL:

```text
https://github.com/charles099-student/pickup-dropoff.git
```

Clone the project:

```bash
git clone https://github.com/charles099-student/pickup-dropoff.git
cd pickup-dropoff
```

## Starting the Application

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

The Vite dev server is configured in `vite.config.ts` to run on port `8001`.

Open the application in a browser:

```text
http://localhost:8001
```

To make the dev server accessible from another device on the same network, run:

```bash
npm run dev -- --host 0.0.0.0
```

Then open the local network URL printed by Vite.

## Unit Testing

This project uses [Vitest](https://vitest.dev/) along with jsdom and React Testing Library for fast and reliable unit testing.

To run the unit tests once:

```bash
npm run test
```

To run tests in watch mode (reruns tests when files change):

```bash
npm run test:watch
```

Recommended components and behaviours to unit test:

- The main `App` UI components and interaction states in `src/test/`.
- `parseRoutePath` in `src/app/routeApi.ts`: converts backend latitude/longitude strings into numbers and rejects invalid coordinates.
- `requestRoute` in `src/app/routeApi.ts`: posts a route request, validates the token response, polls route status, handles success, failure, retryable HTTP statuses, timeout, and aborts.
- `delay` in `src/app/routeApi.ts`: resolves after the configured time and rejects when an `AbortSignal` is aborted.
- Address autocomplete behaviour in `src/app/App.tsx`: verifies query handling, loading state, successful suggestions, failed API responses, and aborting stale requests.
- Route submission flow in `src/app/App.tsx`: verifies empty input validation, polling state, success rendering, error messages, and clearing/resetting state.
- Saved location behaviour in `src/app/App.tsx`: verifies adding, editing, deleting, and applying Home, Work, and custom saved addresses.

Example test file location:

```text
src/app/routeApi.test.ts
```

Run unit tests in watch mode:

```bash
npm test
```

Run unit tests once, suitable for CI:

```bash
npm run test:run
```

Run tests with coverage:

```bash
npm run test:coverage
```

When testing API functions, mock `fetch` instead of calling the public APIs. This keeps tests fast, repeatable, and independent of network availability.

## Browser Compatibility

The app is intended for modern browsers that support ES modules, modern JavaScript, CSS features used by Vite/Tailwind, and WebGL for MapLibre GL JS.

Supported browser targets:

- Google Chrome
- Microsoft Edge
- Mozilla Firefox
- Safari

Map rendering requires WebGL. If WebGL is disabled or unavailable, the map may not render correctly even if the rest of the React interface loads.

## Production Build

Create an optimized production build:

```bash
npm run build
```

The generated static files are written to:

```text
dist/
```

Preview the production build locally:

```bash
npx vite preview --host 0.0.0.0 --port 4173
```

Open:

```text
http://localhost:4173
```

Deploy the contents of `dist/` to any static web host, such as GitHub Pages, Netlify, Vercel, Firebase Hosting, or an Nginx/Apache static site. If the host supports single-page applications, configure fallback routing to `index.html`.
