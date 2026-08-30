# Civic Foundry — Audio & Atmosphere

## Status

**Target product direction.** The current repository does not establish an accepted full audio-system authority. Treat the principles below as design guidance until audio implementation is specified, tested and merged.

## Goal

Audio should make the city feel inhabited, spatial and reactive without becoming noisy or exhausting during long simulation sessions.

The player spends substantial time watching the city operate. Sound therefore needs to work at multiple zoom levels and over long play periods.

## Core layers

### City bed

A broad ambient layer can communicate overall urban intensity:

- distant traffic;
- wind/weather;
- diffuse crowd activity;
- industrial hum;
- natural ambience near water/vegetation;
- quiet nighttime tone.

This layer should change gradually with density, time, weather and camera position.

### Local spatial sounds

At closer zoom, individual sources can become audible:

- vehicles;
- transit;
- construction;
- emergency sirens;
- industrial machinery;
- parks/crowds;
- rail crossings;
- water infrastructure;
- building/service activity.

The system should avoid playing every simulated object as a separate source. Aggregate or prioritize sources to preserve performance and clarity.

### Interface feedback

UI sounds should confirm actions without becoming intrusive:

- tool selection;
- valid/invalid placement;
- construction commitment;
- warnings;
- panel transitions;
- important simulation events.

Repeated high-frequency actions need restrained feedback.

### Music

Music should support long sessions and the game’s thoughtful model-city identity. It should leave room for city ambience and avoid constantly signaling crisis or triumph.

Potential direction:

- understated modern/orchestral/electronic palette;
- longer-form tracks;
- low repetition fatigue;
- contextual intensity changes rather than hard genre shifts.

Final composition/licensing direction requires separate production decisions.

## Simulation-driven audio

Audio should consume real simulation events/state where useful:

```text
traffic congestion → denser traffic bed
construction project → construction ambience
emergency dispatch → spatial siren activity
storm/flood operation → weather/water intensity
transit station activity → crowd/transit ambience
```

Audio remains presentation state. It must never become an authoritative source for whether an incident, vehicle or project exists.

## Scale and zoom

The soundscape should change with camera scale:

- **metropolitan zoom:** aggregate ambience, major transport/weather cues;
- **district zoom:** corridor, industry, transit and neighborhood texture;
- **street/building zoom:** selected local sources and detailed activity.

Crossfades and source prioritization should avoid abrupt sound popping during zoom.

## Time and weather

Future atmospheric systems can vary audio through:

- day/night;
- rain/storm intensity;
- seasonal conditions if introduced;
- traffic peaks;
- construction schedules;
- event/emergency intensity.

These effects should derive from authoritative time/weather/activity state when those systems exist.

## Performance

Audio must scale to large cities through:

- source pooling;
- distance/importance culling;
- aggregate emitters;
- limited simultaneous voices;
- update cadences slower than the render loop where appropriate.

Do not create one live audio source for every visible vehicle or citizen.

## Accessibility and settings

The target settings model should separate at least:

- master volume;
- music;
- ambience;
- effects/UI;
- optional emergency/siren intensity if needed for comfort.

Important warnings must also be visible; audio cannot be the only channel for critical information.

## Design rule

The city should sound richer as it becomes more complex, but never become a wall of undifferentiated noise. Audio exists to communicate scale, place and activity while supporting long-form strategic play.