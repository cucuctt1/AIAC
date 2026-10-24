/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { CubismFramework, Option } from '@framework/live2dcubismframework';
import * as LAppDefine from './lappdefine';
import { LAppPal } from './lapppal';
import { LAppSubdelegate } from './lappsubdelegate';
import { CubismLogError } from '@framework/utils/cubismdebug';

export let s_instance: LAppDelegate = null;

/**
 * アプリケーションクラス。
 * Cubism SDKの管理を行う。
 */
export class LAppDelegate {
  /**
   * クラスのインスタンス（シングルトン）を返す。
   * インスタンスが生成されていない場合は内部でインスタンスを生成する。
   *
   * @return クラスのインスタンス
   */
  public static getInstance(): LAppDelegate {
    if (s_instance == null) {
      s_instance = new LAppDelegate();
    }

    return s_instance;
  }

  /**
   * クラスのインスタンス（シングルトン）を解放する。
   */
  public static releaseInstance(): void {
    if (s_instance != null) {
      s_instance.release();
    }

    s_instance = null;
  }

  /**
   * ポインタがアクティブになるときに呼ばれる。
   */
  private onPointerBegan(e: PointerEvent): void {
    for (let i = 0; i < this._subdelegates.length; i++) {
      this._subdelegates[i].onPointBegan(e.pageX, e.pageY);
    }
  }

  /**
   * ポインタが動いたら呼ばれる。
   */
  private onPointerMoved(e: PointerEvent): void {
    for (let i = 0; i < this._subdelegates.length; i++) {
      this._subdelegates[i].onPointMoved(e.pageX, e.pageY);
    }
  }

  /**
   * ポインタがアクティブでなくなったときに呼ばれる。
   */
  private onPointerEnded(e: PointerEvent): void {
    for (let i = 0; i < this._subdelegates.length; i++) {
      this._subdelegates[i].onPointEnded(e.pageX, e.pageY);
    }
  }

  /**
   * ポインタがキャンセルされると呼ばれる。
   */
  private onPointerCancel(e: PointerEvent): void {
    for (let i = 0; i < this._subdelegates.length; i++) {
      this._subdelegates[i].onTouchCancel(e.pageX, e.pageY);
    }
  }

  /**
   * Resize canvas and re-initialize view.
   */
  public onResize(): void {
    for (let i = 0; i < this._subdelegates.length; i++) {
      this._subdelegates[i].onResize();
    }
  }

  public playAssistantMotion(group: string, priority: 'normal' | 'force' = 'normal', index = 0): void {
    this._subdelegates[0]?.playAssistantMotion(group, priority, index);
  }

  public setAssistantExpression(expressionId: string): void {
    this._subdelegates[0]?.setAssistantExpression(expressionId);
  }

  public setAssistantSpeaking(speaking: boolean): void {
    this._subdelegates[0]?.setAssistantSpeaking(speaking);
  }

  public setAssistantPose(intent: string, intensity: number): void {
    this._subdelegates[0]?.setAssistantPose(intent, intensity);
  }

  /**
   * 実行処理。
   */
  public run(): void {
    const allowedActiveFps = new Set([15, 30, 60, 120]);
    const allowedReducedFps = new Set([15, 30, 60]);
    const root = document.documentElement;
    let activeFps = Number(root.dataset.renderFps) || 30;
    let reducedFps = Number(root.dataset.reducedFps) || 15;
    let autoReduceFps = root.dataset.autoReduceFps !== 'false';
    if (!allowedActiveFps.has(activeFps)) activeFps = 30;
    if (!allowedReducedFps.has(reducedFps)) reducedFps = 15;
    let lastRenderedAt = 0;
    let activeUntil = performance.now() + 8000;
    const markActive = (): void => { activeUntil = performance.now() + 12000; };
    for (const eventName of ['pointermove', 'assistant-speaking-start', 'assistant-speaking-progress', 'assistant-action', 'assistant-interaction', 'assistant-user-activity', 'assistant-media-state']) {
      window.addEventListener(eventName, markActive, { passive: true });
    }
    window.addEventListener('assistant-settings-change', ((event: CustomEvent<{ renderFps?: number; reducedFps?: number; autoReduceFps?: boolean }>) => {
      const nextActive = Number(event.detail?.renderFps);
      const nextReduced = Number(event.detail?.reducedFps);
      if (allowedActiveFps.has(nextActive)) activeFps = nextActive;
      if (allowedReducedFps.has(nextReduced)) reducedFps = nextReduced;
      autoReduceFps = event.detail?.autoReduceFps !== false;
      markActive();
    }) as EventListener);
    // メインループ
    const loop = (timestamp = performance.now()): void => {
      // インスタンスの有無の確認
      if (s_instance == null) {
        return;
      }

      const currentFps = autoReduceFps && timestamp >= activeUntil ? Math.min(activeFps, reducedFps) : activeFps;
      const frameInterval = 1000 / currentFps;
      if (timestamp - lastRenderedAt >= frameInterval) {
        lastRenderedAt = timestamp - ((timestamp - lastRenderedAt) % frameInterval);

        // Time, physics, model parameters and drawing share the same capped tick.
        LAppPal.updateTime();
        for (let i = 0; i < this._subdelegates.length; i++) {
          this._subdelegates[i].update();
        }
      }

      // Avoid waking JavaScript at the monitor refresh rate when rendering is capped.
      const remaining = Math.max(0, frameInterval - (performance.now() - lastRenderedAt) - 1);
      window.setTimeout(() => requestAnimationFrame(loop), remaining);
    };
    loop();
  }

  /**
   * 解放する。
   */
  private release(): void {
    this.releaseEventListener();
    this.releaseSubdelegates();

    // Cubism SDKの解放
    CubismFramework.dispose();

    this._cubismOption = null;
  }

  /**
   * イベントリスナーを解除する。
   */
  private releaseEventListener(): void {
    document.removeEventListener('pointerup', this.pointBeganEventListener);
    this.pointBeganEventListener = null;
    document.removeEventListener('pointermove', this.pointMovedEventListener);
    this.pointMovedEventListener = null;
    document.removeEventListener('pointerdown', this.pointEndedEventListener);
    this.pointEndedEventListener = null;
    document.removeEventListener('pointerdown', this.pointCancelEventListener);
    this.pointCancelEventListener = null;
  }

  /**
   * Subdelegate を解放する
   */
  private releaseSubdelegates(): void {
    for (let i = 0; i < this._subdelegates.length; i++) {
      this._subdelegates[i].release();
    }

    this._subdelegates.length = 0;
    this._subdelegates = null;
  }

  /**
   * APPに必要な物を初期化する。
   */
  public initialize(): boolean {
    // Cubism SDKの初期化
    this.initializeCubism();

    this.initializeSubdelegates();
    this.initializeEventListener();

    return true;
  }

  /**
   * イベントリスナーを設定する。
   */
  private initializeEventListener(): void {
    this.pointBeganEventListener = this.onPointerBegan.bind(this);
    this.pointMovedEventListener = this.onPointerMoved.bind(this);
    this.pointEndedEventListener = this.onPointerEnded.bind(this);
    this.pointCancelEventListener = this.onPointerCancel.bind(this);

    // ポインタ関連コールバック関数登録
    document.addEventListener('pointerdown', this.pointBeganEventListener, {
      passive: true
    });
    document.addEventListener('pointermove', this.pointMovedEventListener, {
      passive: true
    });
    document.addEventListener('pointerup', this.pointEndedEventListener, {
      passive: true
    });
    document.addEventListener('pointercancel', this.pointCancelEventListener, {
      passive: true
    });
  }

  /**
   * Cubism SDKの初期化
   */
  private initializeCubism(): void {
    LAppPal.updateTime();

    // setup cubism
    this._cubismOption.logFunction = LAppPal.printMessage;
    this._cubismOption.loggingLevel = LAppDefine.CubismLoggingLevel;
    CubismFramework.startUp(this._cubismOption);

    // initialize cubism
    CubismFramework.initialize();
  }

  /**
   * Canvasを生成配置、Subdelegateを初期化する
   */
  private initializeSubdelegates(): void {
    let width: number = 100;
    let height: number = 100;
    if (LAppDefine.CanvasNum > 3) {
      const widthunit: number = Math.ceil(Math.sqrt(LAppDefine.CanvasNum));
      const heightUnit = Math.ceil(LAppDefine.CanvasNum / widthunit);
      width = 100.0 / widthunit;
      height = 100.0 / heightUnit;
    } else {
      width = 100.0 / LAppDefine.CanvasNum;
    }

    this._canvases.length = LAppDefine.CanvasNum;
    this._subdelegates.length = LAppDefine.CanvasNum;
    for (let i = 0; i < LAppDefine.CanvasNum; i++) {
      const canvas = document.getElementById('live2d') as HTMLCanvasElement;
      if (!canvas) throw new Error('Live2D canvas was not found');
      this._canvases[i] = canvas;
      canvas.style.width = '100%';
      canvas.style.height = '100%';

      // キャンバスを DOM に追加
    }

    for (let i = 0; i < this._canvases.length; i++) {
      const subdelegate = new LAppSubdelegate();
      subdelegate.initialize(this._canvases[i]);
      this._subdelegates[i] = subdelegate;
    }

    for (let i = 0; i < LAppDefine.CanvasNum; i++) {
      if (this._subdelegates[i].isContextLost()) {
        CubismLogError(
          `The context for Canvas at index ${i} was lost, possibly because the acquisition limit for WebGLRenderingContext was reached.`
        );
      }
    }
  }

  /**
   * Privateなコンストラクタ
   */
  private constructor() {
    this._cubismOption = new Option();
    this._subdelegates = new Array<LAppSubdelegate>();
    this._canvases = new Array<HTMLCanvasElement>();
  }

  /**
   * Cubism SDK Option
   */
  private _cubismOption: Option;

  /**
   * 操作対象のcanvas要素
   */
  private _canvases: Array<HTMLCanvasElement>;

  /**
   * Subdelegate
   */
  private _subdelegates: Array<LAppSubdelegate>;

  /**
   * 登録済みイベントリスナー 関数オブジェクト
   */
  private pointBeganEventListener: (this: Document, ev: PointerEvent) => void;

  /**
   * 登録済みイベントリスナー 関数オブジェクト
   */
  private pointMovedEventListener: (this: Document, ev: PointerEvent) => void;

  /**
   * 登録済みイベントリスナー 関数オブジェクト
   */
  private pointEndedEventListener: (this: Document, ev: PointerEvent) => void;

  /**
   * 登録済みイベントリスナー 関数オブジェクト
   */
  private pointCancelEventListener: (this: Document, ev: PointerEvent) => void;
}
