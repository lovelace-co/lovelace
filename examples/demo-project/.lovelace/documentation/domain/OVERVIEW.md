---
id: domain-overview
type: document
summary: Forecast, observation and location terminology used across Orbit.
updated: 2026-06-01T09:30:00Z
---

# Domain

- **Location.** A named point with latitude and longitude. Identified by a slug, for example `sydney-nsw`.
- **Observation.** A measured value at a time: temperature, wind, humidity.
- **Forecast.** A list of predicted observations for a location, in three-hour steps, covering seven days.
- **Provider.** The upstream service Orbit normalises. Provider quirks stay in the fetcher; nothing downstream sees raw provider data.
