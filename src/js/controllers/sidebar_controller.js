import { Controller } from "@hotwired/stimulus";

const MOBILE_WIDTH = 768;
const MIN_WIDTH = 220;
const MAX_WIDTH = 560;
const EDITOR_MIN_WIDTH = 360;
const DEFAULT_WIDTH = 260;
const KEY_STEP = 16;

export default class SidebarController extends Controller {
  static targets = [
    "separator",
  ];

  /**
   * Initialize the accessible separator.
   */
  connect() {
    this.workspaceElement = this.element.parentElement;
    this.pointerId = null;
    this.sync();
  }

  /**
   * Release pointer capture and drag styling when removed.
   */
  disconnect() {
    this.finish();
  }

  /**
   * Read the maximum width while leaving room for the editor.
   *
   * @returns {number} Largest sidebar width in CSS pixels.
   */
  get maxWidth() {
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, this.workspaceElement.clientWidth - EDITOR_MIN_WIDTH));
  }

  /**
   * Keep accessibility values aligned with the responsive layout.
   */
  sync() {
    if (innerWidth <= MOBILE_WIDTH) {
      this.finish();
    }

    this.separatorTarget.setAttribute("aria-valuemin", MIN_WIDTH);
    this.separatorTarget.setAttribute("aria-valuemax", this.maxWidth);
    this.separatorTarget.setAttribute(
      "aria-valuenow",
      Math.round(this.element.getBoundingClientRect().width),
    );
  }

  /**
   * Apply a constrained width to the workspace grid.
   *
   * @param {number} width - Requested width in CSS pixels.
   */
  resize(width) {
    const next = Math.max(MIN_WIDTH, Math.min(this.maxWidth, width));
    this.workspaceElement.style.setProperty("--sidebar-w", `${next}px`);
    this.sync();
  }

  /**
   * Start dragging from the current boundary without a width jump.
   *
   * @param {PointerEvent} event - Pointer pressing the separator.
   */
  start(event) {
    if (event.button !== 0 || innerWidth <= MOBILE_WIDTH || this.pointerId !== null) {
      return;
    }

    event.preventDefault();
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startWidth = this.element.getBoundingClientRect().width;
    this.separatorTarget.setPointerCapture(event.pointerId);
    this.workspaceElement.classList.add("sidebar-resizing");
  }

  /**
   * Resize only for the pointer owning this drag.
   *
   * @param {PointerEvent} event - Captured pointer movement.
   */
  move(event) {
    if (this.pointerId !== event.pointerId) {
      return;
    }

    this.resize(this.startWidth + event.clientX - this.startX);
  }

  /**
   * End the drag after release, cancellation, capture loss or removal.
   *
   * @param {PointerEvent} [event] - Pointer ending the drag, when triggered by an event.
   */
  finish(event) {
    if (event && this.pointerId !== event.pointerId) {
      return;
    }

    const pointerId = this.pointerId;
    this.pointerId = null;
    this.workspaceElement.classList.remove("sidebar-resizing");
    if (pointerId !== null && this.separatorTarget.hasPointerCapture(pointerId)) {
      this.separatorTarget.releasePointerCapture(pointerId);
    }
  }

  /**
   * Support keyboard resizing and restoring the initial width.
   *
   * @param {KeyboardEvent} event - Keyboard input on the separator.
   */
  keydown(event) {
    const width = this.element.getBoundingClientRect().width;

    const widths = new Map([
      [
        "ArrowLeft",
        width - KEY_STEP,
      ],
      [
        "ArrowRight",
        width + KEY_STEP,
      ],
      [
        "Home",
        MIN_WIDTH,
      ],
      [
        "End",
        this.maxWidth,
      ],
      [
        "Enter",
        DEFAULT_WIDTH,
      ],
    ]);

    if (!widths.has(event.key)) {
      return;
    }

    event.preventDefault();
    this.resize(widths.get(event.key));
  }

  /**
   * Restore the default sidebar width on double click.
   */
  reset() {
    this.resize(DEFAULT_WIDTH);
  }
}
