/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

"use strict";
const fs = require('fs');
const publicResources = [
  {src: '../vendor/cubism/Core', dst: './public/Core'},
  {src: '../assets/background', dst: './public/Background'},
  {src: '../assets/soundext', dst: './public/SfxExt'},
  {src: '../vendor/cubism/Framework/Shaders', dst: './public/Framework/Shaders'},
];

publicResources.forEach((e)=>{if (fs.existsSync(e.dst)) fs.rmSync(e.dst, { recursive: true })});
publicResources.forEach((e)=>{if (!fs.existsSync(e.src)) throw new Error(`Missing required runtime source: ${e.src}`); fs.cpSync(e.src, e.dst, {recursive: true})});
