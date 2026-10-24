/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import { CubismViewMatrix } from '@framework/math/cubismviewmatrix';

import * as LAppDefine from './lappdefine';
import { LAppDelegate } from './lappdelegate';
import { LAppPal } from './lapppal';
import { TouchManager } from './touchmanager';
import { LAppSubdelegate } from './lappsubdelegate';

/**
 * 描画クラス。
 */
export class LAppView {
  /**
   * コンストラクタ
   */
  public constructor() {
    this._programId = null;

    // タッチ関係のイベント管理
    this._touchManager = new TouchManager();

    // デバイス座標からスクリーン座標に変換するための
    this._deviceToScreen = new CubismMatrix44();

    // 画面の表示の拡大縮小や移動の変換を行う行列
    this._viewMatrix = new CubismViewMatrix();
    this._interactionX = 0.0;
    this._interactionY = 0.0;
    this._interactionTargetX = 0.0;
    this._interactionTargetY = 0.0;
    this._interactionActive = false;
    this._interactionDelayRemaining = 0.0;
    this._assistantSpeaking = false;
    this._gazeStrength = 1.0;
    window.addEventListener('assistant-settings-change', ((event: CustomEvent) => {
      const value = Number(event.detail?.gazeStrength);
      if (Number.isFinite(value)) this._gazeStrength = Math.max(0, Math.min(1.5, value));
    }) as EventListener);
    window.addEventListener('assistant-speaking-start', () => {
      this._assistantSpeaking = true;
      this.onHoverEnded();
    });
    window.addEventListener('assistant-speaking-end', () => {
      this._assistantSpeaking = false;
    });
  }

  /**
   * 初期化する。
   */
  public initialize(subdelegate: LAppSubdelegate): void {
    this._subdelegate = subdelegate;
    const { width, height } = subdelegate.getCanvas();

    const ratio: number = width / height;
    const left: number = -ratio;
    const right: number = ratio;
    const bottom: number = LAppDefine.ViewLogicalLeft;
    const top: number = LAppDefine.ViewLogicalRight;

    this._viewMatrix.setScreenRect(left, right, bottom, top); // デバイスに対応する画面の範囲。 Xの左端、Xの右端、Yの下端、Yの上端
    this._viewMatrix.scale(LAppDefine.ViewScale, LAppDefine.ViewScale);
    this._viewMatrix.translate(0.059568, -1.436097);

    this._deviceToScreen.loadIdentity();
    if (width > height) {
      const screenW: number = Math.abs(right - left);
      this._deviceToScreen.scaleRelative(screenW / width, -screenW / width);
    } else {
      const screenH: number = Math.abs(top - bottom);
      this._deviceToScreen.scaleRelative(screenH / height, -screenH / height);
    }
    this._deviceToScreen.translateRelative(-width * 0.5, -height * 0.5);

    // 表示範囲の設定
    this._viewMatrix.setMaxScale(LAppDefine.ViewMaxScale); // 限界拡張率
    this._viewMatrix.setMinScale(LAppDefine.ViewMinScale); // 限界縮小率

    // 表示できる最大範囲
    this._viewMatrix.setMaxScreenRect(
      LAppDefine.ViewLogicalMaxLeft,
      LAppDefine.ViewLogicalMaxRight,
      LAppDefine.ViewLogicalMaxBottom,
      LAppDefine.ViewLogicalMaxTop
    );
  }

  /**
   * 解放する
   */
  public release(): void {
    this._viewMatrix = null;
    this._touchManager = null;
    this._deviceToScreen = null;

    this._subdelegate.getGlManager().getGl().deleteProgram(this._programId);
    this._programId = null;
  }

  /**
   * 描画する。
   */
  public render(): void {
    this._subdelegate.getGlManager().getGl().useProgram(this._programId);

    this._subdelegate.getGlManager().getGl().flush();

    const lapplive2dmanager = this._subdelegate.getLive2DManager();
    if (lapplive2dmanager != null) {
      this.updateInteractionPoint();
      lapplive2dmanager.setViewMatrix(this._viewMatrix);

      lapplive2dmanager.onUpdate();
    }
  }

  /**
   * 画像の初期化を行う。
   */
  public initializeSprite(): void {
    // Custom models provide textures; CSS provides the app background.
    if (this._programId == null) this._programId = this._subdelegate.createShader();
  }

  /**
   * タッチされた時に呼ばれる。
   *
   * @param pointX スクリーンX座標
   * @param pointY スクリーンY座標
   */
  public onTouchesBegan(pointX: number, pointY: number): void {
    this._touchManager.touchesBegan(
      pointX * window.devicePixelRatio,
      pointY * window.devicePixelRatio
    );
  }

  /**
   * タッチしているときにポインタが動いたら呼ばれる。
   *
   * @param pointX スクリーンX座標
   * @param pointY スクリーンY座標
   */
  public onTouchesMoved(pointX: number, pointY: number): void {
    if (this._assistantSpeaking) return;
    const posX = pointX * window.devicePixelRatio;
    const posY = pointY * window.devicePixelRatio;

    this._touchManager.touchesMoved(posX, posY);

    const canvas = this._subdelegate.getCanvas();
    const viewX = (pointX / canvas.clientWidth) * 2.0 - 1.0;
    const viewY = 1.0 - (pointY / canvas.clientHeight) * 2.0;

    if (!this._interactionActive) {
      this._interactionActive = true;
      const stillNearCenter =
        Math.abs(this._interactionX) + Math.abs(this._interactionY) < 0.01;
      this._interactionDelayRemaining = stillNearCenter ? 0.3 : 0.0;
    }

    this._interactionTargetX = viewX * this._gazeStrength;
    this._interactionTargetY = viewY * this._gazeStrength;
  }

  /**
   * タッチが終了したら呼ばれる。
   *
   * @param pointX スクリーンX座標
   * @param pointY スクリーンY座標
   */
  public onTouchesEnded(pointX: number, pointY: number): void {
    const posX = pointX * window.devicePixelRatio;
    const posY = pointY * window.devicePixelRatio;

    const lapplive2dmanager = this._subdelegate.getLive2DManager();

    // シングルタップ
    const x: number = this.transformViewX(posX);
    const y: number = this.transformViewY(posY);

    if (LAppDefine.DebugTouchLogEnable) {
      LAppPal.printMessage(`[APP]touchesEnded x: ${x} y: ${y}`);
    }
    lapplive2dmanager.onTap(x, y);

    // 歯車にタップしたか
  }

  public onHoverEnded(): void {
    this._interactionActive = false;
    this._interactionDelayRemaining = 0.0;
    this._interactionTargetX = 0.0;
    this._interactionTargetY = 0.0;
  }

  private updateInteractionPoint(): void {
    const dt = Math.min(Math.max(LAppPal.getDeltaTime(), 0.0), 0.1);

    if (this._interactionActive && this._interactionDelayRemaining > 0.0) {
      this._interactionDelayRemaining = Math.max(
        0.0,
        this._interactionDelayRemaining - dt
      );
    } else {
      const speed = this._assistantSpeaking
        ? 4.0
        : this._interactionActive ? 2.5 : 1.5;
      const alpha = 1.0 - Math.exp(-speed * dt);
      this._interactionX +=
        (this._interactionTargetX - this._interactionX) * alpha;
      this._interactionY +=
        (this._interactionTargetY - this._interactionY) * alpha;
    }

    this._subdelegate
      .getLive2DManager()
      .onDrag(this._interactionX, this._interactionY);
  }

  /**
   * X座標をView座標に変換する。
   *
   * @param deviceX デバイスX座標
   */
  public transformViewX(deviceX: number): number {
    const screenX: number = this._deviceToScreen.transformX(deviceX); // 論理座標変換した座標を取得。
    return this._viewMatrix.invertTransformX(screenX); // 拡大、縮小、移動後の値。
  }

  /**
   * Y座標をView座標に変換する。
   *
   * @param deviceY デバイスY座標
   */
  public transformViewY(deviceY: number): number {
    const screenY: number = this._deviceToScreen.transformY(deviceY); // 論理座標変換した座標を取得。
    return this._viewMatrix.invertTransformY(screenY);
  }

  /**
   * X座標をScreen座標に変換する。
   * @param deviceX デバイスX座標
   */
  public transformScreenX(deviceX: number): number {
    return this._deviceToScreen.transformX(deviceX);
  }

  /**
   * Y座標をScreen座標に変換する。
   *
   * @param deviceY デバイスY座標
   */
  public transformScreenY(deviceY: number): number {
    return this._deviceToScreen.transformY(deviceY);
  }

  _touchManager: TouchManager; // タッチマネージャー
  _gazeStrength: number;
  _deviceToScreen: CubismMatrix44; // デバイスからスクリーンへの行列
  _viewMatrix: CubismViewMatrix; // viewMatrix
  _programId: WebGLProgram; // シェーダID
  _changeModel: boolean; // モデル切り替えフラグ
  _isClick: boolean; // クリック中
  private _subdelegate: LAppSubdelegate;
  private _interactionX: number;
  private _interactionY: number;
  private _interactionTargetX: number;
  private _interactionTargetY: number;
  private _interactionActive: boolean;
  private _interactionDelayRemaining: number;
  private _assistantSpeaking: boolean;
}
