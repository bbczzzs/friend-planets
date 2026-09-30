// Controls, adapted from the "Steal An Egg" FriendSDK example (Apache-2.0).
// Desktop: WASD / up-down arrows move relative to the camera, dragging (either
// button) or left/right arrows turn it, wheel or I/O zoom, Space jumps, E uses
// things, Shift boosts. Touch: a thumbstick appears under the left thumb,
// dragging anywhere else turns the camera, pinching zooms.
import type { OrbitCamera } from "./camera";

export type StickElements = { base: HTMLElement; knob: HTMLElement };
const MOVE_KEYS: Record<string, [number, number]> = { w: [0, 1], s: [0, -1], a: [-1, 0], d: [1, 0], arrowup: [0, 1], arrowdown: [0, -1] };
const HANDLED = new Set([...Object.keys(MOVE_KEYS), "arrowleft", "arrowright", " ", "e", "i", "o", "shift", "c", "f", "q", "enter", "escape"]);
const STICK_RADIUS = 46;

export class Input {
  enabled = false;
  /** When set, drags are reported here (e.g. aiming a kick) instead of turning the camera. */
  onDrag: ((dx: number, dy: number) => void) | null = null;
  onTap: ((x: number, y: number) => void) | null = null;
  private keys = new Set<string>();
  private queued = new Set<string>();
  private stick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  private drags = new Map<number, { x: number; y: number; sx: number; sy: number; t: number; touch: boolean }>();
  private pinch = 0;
  private cleanup: (() => void)[] = [];

  constructor(private surface: HTMLElement, private camera: OrbitCamera, private stickElements: StickElements) {
    const on = <K extends keyof GlobalEventHandlersEventMap>(target: EventTarget, type: K, handler: (event: GlobalEventHandlersEventMap[K]) => void, options?: AddEventListenerOptions) => {
      target.addEventListener(type, handler as EventListener, options);
      this.cleanup.push(() => target.removeEventListener(type, handler as EventListener, options));
    };
    on(window, "keydown", event => this.key(event, true));
    on(window, "keyup", event => this.key(event, false));
    on(window, "blur", () => this.release());
    const hidden = () => this.release();
    document.addEventListener("visibilitychange", hidden);
    this.cleanup.push(() => document.removeEventListener("visibilitychange", hidden));
    on(surface, "contextmenu", event => event.preventDefault());
    on(surface, "wheel", event => { if (this.enabled) { event.preventDefault(); this.camera.zoom(Math.sign(event.deltaY)); } }, { passive: false });
    on(surface, "pointerdown", event => this.pointerDown(event));
    on(surface, "pointermove", event => this.pointerMove(event));
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) on(surface, type, event => this.pointerUp(event));
  }

  private key(event: KeyboardEvent, down: boolean) {
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    const key = event.key.toLowerCase();
    if (!this.enabled) { this.keys.delete(key); return; }
    if (!HANDLED.has(key) || event.ctrlKey || event.metaKey || event.altKey) return;
    if ((key === " " || key === "enter") && target?.tagName === "BUTTON") return;
    event.preventDefault();
    if (down) {
      if (!event.repeat) {
        this.queued.add(key);
        if (key === "i") this.camera.zoom(-1);
        if (key === "o") this.camera.zoom(1);
      }
      this.keys.add(key);
    } else this.keys.delete(key);
  }

  private pointerDown(event: PointerEvent) {
    if (!this.enabled || event.target !== this.surface) return;
    this.surface.focus({ preventScroll: true });
    const rect = this.surface.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const touch = event.pointerType !== "mouse";
    try { this.surface.setPointerCapture(event.pointerId); } catch { /* synthetic events have no capture target */ }
    if (touch && !this.stick && !this.onDrag && x < rect.width * 0.45 && y > rect.height * 0.3) {
      this.stick = { id: event.pointerId, ox: x, oy: y, x: 0, y: 0 };
      this.showStick();
    } else {
      this.drags.set(event.pointerId, { x: event.clientX, y: event.clientY, sx: event.clientX, sy: event.clientY, t: performance.now(), touch });
      this.pinch = 0;
    }
    event.preventDefault();
  }

  private pointerMove(event: PointerEvent) {
    if (this.stick?.id === event.pointerId) {
      const rect = this.surface.getBoundingClientRect();
      let dx = event.clientX - rect.left - this.stick.ox, dy = event.clientY - rect.top - this.stick.oy;
      const length = Math.hypot(dx, dy);
      if (length > STICK_RADIUS) { dx *= STICK_RADIUS / length; dy *= STICK_RADIUS / length; }
      this.stick.x = dx / STICK_RADIUS; this.stick.y = -dy / STICK_RADIUS;
      this.showStick();
      return;
    }
    const drag = this.drags.get(event.pointerId);
    if (!drag) return;
    if (this.drags.size >= 2) {
      drag.x = event.clientX; drag.y = event.clientY;
      const [a, b] = [...this.drags.values()], spread = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch > 0 && spread > 0) this.camera.zoom(Math.log(this.pinch / spread) / Math.log(1.22));
      this.pinch = spread;
      return;
    }
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (this.onDrag) this.onDrag(dx, dy); else this.camera.rotate(dx, dy, drag.touch);
    drag.x = event.clientX; drag.y = event.clientY;
  }

  private pointerUp(event: PointerEvent) {
    if (this.stick?.id === event.pointerId) { this.stick = null; this.showStick(); }
    const drag = this.drags.get(event.pointerId);
    if (drag && this.onTap && Math.hypot(event.clientX - drag.sx, event.clientY - drag.sy) < 10 && performance.now() - drag.t < 400) {
      const rect = this.surface.getBoundingClientRect();
      this.onTap(event.clientX - rect.left, event.clientY - rect.top);
    }
    if (this.drags.delete(event.pointerId)) this.pinch = 0;
  }

  private showStick() {
    const { base, knob } = this.stickElements;
    base.style.display = this.stick ? "block" : "none";
    if (!this.stick) return;
    base.style.transform = `translate(${this.stick.ox}px, ${this.stick.oy}px)`;
    knob.style.transform = `translate(${this.stick.x * STICK_RADIUS}px, ${-this.stick.y * STICK_RADIUS}px)`;
  }

  /** Movement intent: x = right, y = forward, length ≤ 1. */
  move(): [number, number] {
    if (!this.enabled) return [0, 0];
    if (this.stick) {
      const length = Math.hypot(this.stick.x, this.stick.y);
      return length < 0.18 ? [0, 0] : [this.stick.x, this.stick.y];
    }
    let x = 0, y = 0;
    for (const key of this.keys) { const axis = MOVE_KEYS[key]; if (axis) { x += axis[0]; y += axis[1]; } }
    const length = Math.hypot(x, y);
    return length > 1 ? [x / length, y / length] : [x, y];
  }
  keyYaw() { return this.enabled ? Number(this.keys.has("arrowleft")) - Number(this.keys.has("arrowright")) : 0; }
  held(key: string) { return this.enabled && this.keys.has(key); }
  /** True once per key press (Space, E, C, F, Enter…). */
  take(key: string) { const had = this.queued.has(key); this.queued.delete(key); return had && this.enabled; }
  press(key: string) { if (this.enabled) this.queued.add(key); }
  hold(key: string, down: boolean) { if (down && this.enabled) { this.keys.add(key); this.queued.add(key); } else this.keys.delete(key); }
  hasStick() { return Boolean(this.stick); }
  /** Presses only count in the frame they happen, so a stray key never fires later in another mode. */
  endFrame() { this.queued.clear(); }

  setEnabled(enabled: boolean) { this.enabled = enabled; if (!enabled) this.release(); }
  release() {
    this.keys.clear(); this.drags.clear(); this.queued.clear(); this.stick = null; this.pinch = 0;
    this.showStick();
  }
  dispose() { this.release(); for (const remove of this.cleanup) remove(); this.cleanup = []; }
}
