# Fly Brain Lab

A whole fruit fly brain (138,639 neurons, 15 million connections from the FlyWire connectome) running on
this PC. Give it a sense, watch every spike light up in 3D, and see which behaviour comes out.

Start it with `run.bat`, then open http://127.0.0.1:8795.

**Fly World** (`run_world.bat`, http://127.0.0.1:8796) puts the same brain into a 3D world, in a live closed loop.
It switches between Heaven and Hell.
- Heaven (`world/heaven.js`): a golden meadow with giant daisies, tulips, sunflowers and bluebells, blossom
  trees, a lotus pond, strawberries, cherries, mushrooms, butterflies, floating islands with waterfalls, a
  rainbow and light rays.
- Hell: ash, lava cracks, swooping shadows, and nothing to eat or drink.

## What you can do
- **Senses:** sugar, bitter, water, antenna touch, and a looming shadow on the left or right eye.
- **Optogenetics:** switch on any of ~8,000 cell types by name (for example `MDN`, `DNp01`, `CB0701`).
- **Knock out:** silence a cell type and see what still works. The "silence" button in the neuron table does
  the same for one row.
- **Readouts:** the command and motor neurons for eating (MN9), antenna grooming (aDN1/aBN1), escape takeoff
  (Giant Fiber), walking backwards (MDN) and turning (DNa02).

## What the model does (try the presets)
| Input | What the simulated brain does |
|---|---|
| Sugar 150 Hz | MN9 ~65 Hz: the proboscis comes out to eat |
| Sugar + bitter | MN9 goes silent: bitter vetoes the meal |
| Water 250 Hz | MN9 ~35 Hz |
| Antenna touch | aDN1/aBN1 fire: antenna grooming |
| Shadow from the right | Giant Fiber ~140 Hz (takeoff), plus left DNa02: it turns away. The left shadow mirrors this |
| MDN switched on | Walks backwards |
| Shadow, Giant Fiber silenced | No takeoff, but it still turns away |

None of these behaviours are programmed in. They come only from the wiring diagram and one neuron model.

## Fly World: its own mind
The fly is not a script that waits for input. A small "mind" in `world/world.js` makes random urges that rise
and fade in bouts: wander, turn left, turn right, back up, groom, probe and take off. Hunger, thirst and the
realm shape how often each one comes.
- Urges are not actions. Each one is sent into the brain at the central neurons with the most excitatory
  synapses onto a command neuron (DNp09 walk, DNa02 turn, MDN back, aDN1 groom, MN9 proboscis, Giant Fiber
  takeoff).
- What the command neurons then do is the only thing that moves the body. Food-seeking also goes through the
  brain: the smell compass only adds an urge to turn toward the food.
- Quirks that come from the wiring:
  - Walking leaks into the right-turn neuron. The mind slowly learns to counter-steer.
  - Walking leaks into the Giant Fiber, so a strong walking urge can end in a sudden takeoff.
  - The proboscis circuit latches: MN9 keeps firing on its own. A brief inhibitory pulse to that urge's entry
    neurons releases it, both when a bout ends and when MN9 runs for over a second with no reason.
- Background noise alone cannot make it spontaneous. The model is bistable: below a threshold it is silent,
  and above it the whole brain locks into runaway activity. "Wander" plus "turn right" can also tip it over
  now and then. The server resets the brain to rest if it stays above 150k spikes/s for 3 steps, and the HUD
  says so.

## Fly World: what is brain and what is body
Every ~40 ms of brain time the page sends what the fly senses and gets back its motor neuron rates. The brain runs
in real time on this CPU.
- **Brain (connectome):**
  - Eating and drinking when it touches sugar or water: MN9 extends the proboscis.
  - Refusing bitter berries: bitter silences MN9.
  - Stopping when full: hunger and thirst only scale how hard the taste neurons fire, and MN9 falls silent on
    its own.
  - Grooming when ash or petals hit the antennae: aDN1/aBN1.
  - Escape takeoff from swooping shadows: the Giant Fiber.
  - Steering away from a shadow: DNa02 turns the fly ipsilaterally.
  - Backing up: MDN.
- **Body (simple reflexes, shown with a blue BODY tag):**
  - Walking gait, the urge to explore, and free flights in Heaven.
  - Energy and water levels.
  - The smell compass that leads it to food.
- Why smell is not done by the brain: driving the smell neurons (ORNs) sends this model into runaway activity
  (about 470k spikes/s that keep going after the smell stops). This happens even with one smell type at 20 Hz,
  in both `sim.py` and `live.py`. The published model has no adaptation and only rough inhibition, so smell is
  outside what it can do.
- `live.py` is the closed-loop engine: the same equations compiled with numba, keeping its state between calls.
  - Neurons that cannot reach threshold without new input are left asleep and fast-forwarded exactly when input
    arrives.
  - It agrees with `sim.py` at r = 0.995.
  - Sugar runs 5× faster than real time, and a looming shadow about at real time.

## How it works
- `Drosophila_brain_model/` is the cloned [philshiu/Drosophila_brain_model](https://github.com/philshiu/Drosophila_brain_model)
  (Shiu et al., *Nature* 2024). It provides the v783 connectome files and the reference Brian2 model.
- `data/neuron_annotations.tsv` contains positions and cell types from
  [flyconnectome/flywire_annotations](https://github.com/flyconnectome/flywire_annotations) (Schlegel et al., *Nature* 2024).
- `prep.py` packs both into `data/brain.npz` (run it once).
- `sim.py` is a numpy port of the same leaky integrate-and-fire equations and constants.
  - Brian2 on Windows needs a C++ compiler to run fast; this port runs 0.5 s of brain time in 3 to 10 s.
  - It only updates neurons that are away from rest, and it only spreads the spikes that happened.
  - Checked against the original Brian2 code (sugar 100 Hz, `validate_brian.py`): firing rates correlate at r = 0.995,
    and MN9 is 68.0 Hz in Brian2 against 67.5 Hz here. Brian2 drops input that arrives during the refractory period, and this port does too.
  - One change from the original: a silenced neuron cannot fire either. The original only cuts its outputs.
- `validate_brian.py` runs the original Brian2 code and this port side by side.
- `server.py` runs the local web app. Four worker processes run trials in parallel.
- `ui/` holds the page: three.js point cloud of every neuron, spike replay, an SVG fly, and behaviour meters.

## Setup from scratch
```
uv venv .venv --python 3.12
uv pip install --python .venv/Scripts/python.exe numpy scipy pandas pyarrow brian2 joblib numba
git clone --depth 1 https://github.com/philshiu/Drosophila_brain_model.git
curl -L -o data/neuron_annotations.tsv https://raw.githubusercontent.com/flyconnectome/flywire_annotations/main/supplemental_files/Supplemental_file1_neuron_annotations.tsv
.venv/Scripts/python prep.py
```
