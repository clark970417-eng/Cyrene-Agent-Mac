---
title: Cyrene LoRA Studio
emoji: 🌸
colorFrom: purple
colorTo: pink
sdk: gradio
sdk_version: 6.24.0
python_version: 3.12
app_file: app.py
pinned: false
license: openrail++
models:
  - cagliostrolab/animagine-xl-4.0
---

# Cyrene LoRA Studio

Private Gradio API for generating Cyrene portraits with Animagine XL 4.0 and the
personal `cyrene_hsr_animagine_xl4.safetensors` adapter.

The desktop app calls the `/generate` API endpoint. Select **ZeroGPU** as this
Space's hardware after creating it.

