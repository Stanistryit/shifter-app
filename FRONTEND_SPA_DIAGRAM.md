# Frontend SPA Diagram

This diagram decomposes the frontend into modules and shows the runtime flow:
`API -> state -> render`.

```mermaid
flowchart TB
    userClient["User (Telegram WebApp / Browser)"] --> spaShell["SPA Shell (index.html + app.js)"]

    subgraph frontendSpa [Frontend SPA Modules]
        appModule["app.js (orchestrator)"]
        apiModule["api.js (fetchJson/postJson)"]
        stateModule["state.js (single state object)"]
        renderHub["render.js (render coordinator)"]
        renderTimeline["render_timeline.js"]
        renderKpi["render_kpi.js"]
        renderTodo["render_todo.js"]
        dashboardModule["dashboard.js"]
        swModule["sw.js (Service Worker)"]
        domUi["DOM/UI (tabs, cards, tables, modals)"]
    end

    subgraph backendSys [Backend Services]
        expressApi["Express /api routes"]
        sseStream["SSE stream /api/notifications/stream"]
        pushApi["Push endpoints /api/push/*"]
    end

    mongoDb[(MongoDB)]
    telegramBot["Telegram Bot"]
    agendaScheduler["Agenda Scheduler"]
    browserPush["Browser Push API"]

    spaShell --> appModule
    appModule --> apiModule
    apiModule --> expressApi
    expressApi --> apiModule
    apiModule --> appModule

    appModule --> stateModule
    stateModule --> renderHub
    renderHub --> renderTimeline
    renderHub --> renderKpi
    renderHub --> renderTodo
    renderTimeline --> domUi
    renderKpi --> domUi
    renderTodo --> domUi
    stateModule --> dashboardModule
    dashboardModule --> domUi

    appModule -->|"open stream"| sseStream
    sseStream -->|"notification events"| appModule
    appModule -->|"refresh/update state"| stateModule

    appModule -->|"register SW + subscribe"| swModule
    swModule --> browserPush
    appModule --> pushApi
    pushApi --> expressApi
    browserPush --> swModule
    swModule -->|"notification click -> app URL"| appModule

    expressApi --> mongoDb
    expressApi --> telegramBot
    agendaScheduler --> expressApi
    agendaScheduler --> telegramBot
    agendaScheduler --> pushApi
```

## Legend

- `app.js` coordinates app startup, mode switching, API calls, and event wiring.
- `state.js` is the shared runtime state; render modules consume it to update UI.
- `render.js` delegates to specialized renderers (`timeline`, `kpi`, `todo`) for DOM updates.
- Real-time events (SSE, Web Push) feed back into the same state/render cycle.
