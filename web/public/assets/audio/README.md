# WILDCARD audio assets

Runtime audio is routed through `web/lib/sound.ts`.

Drop original, project-owned clips here when available:

```text
sfx/
  card-draw.*
  card-flip.*
  card-shuffle.*
  card-slide.*
  chips.*
  bet.*
  pot-win.*
  magic-activate.*
  magic-blocked.*
  shield.*
  steal.*
  win.*
  lose.*
voices/
  hero-01/
    raise.*
    fold.*
    magic.*
    steal.*
    block.*
    showdown.*
    win.*
    lose.*
```

Do not add celebrity, actor, streamer, or existing character voice likenesses. Until original clips are added, `AudioManager` uses short synthesized cues with cooldown and probability gating.
