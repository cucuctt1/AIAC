/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { LAppDelegate } from './lappdelegate';
import * as LAppDefine from './lappdefine';
import './assistantactions';

/**
 * ブラウザロード後の処理
 */
window.addEventListener(
  'load',
  (): void => {
    // Initialize WebGL and create the application instance
    if (!LAppDelegate.getInstance().initialize()) {
      return;
    }

    if (!(window as any).contentPacks?.get()?.model) {
      (window as any).live2d?.ready();
    }

    LAppDelegate.getInstance().run();
  },
  { passive: true }
);

/**
 * 終了時の処理
 */
window.addEventListener(
  'beforeunload',
  (): void => LAppDelegate.releaseInstance(),
  { passive: true }
);
