import { Application } from "@hotwired/stimulus";

/**
 * Start Stimulus and report controller loading failures.
 *
 * @param {() => Promise<object>} loadController - Load controller registrations after Stimulus starts.
 * @returns {Promise<Application|undefined>} Started Stimulus application, or undefined after a reported loading failure.
 */
export async function startEditor(loadController = () => import("./controllers/index.js")) {
  try {
    const { controllers } = await loadController();
    const app = Application.start();

    for (const [
      name,
      controller,
    ] of Object.entries(controllers)) {
      app.register(name, controller);
    }

    return app;
  } catch (error) {
    console.error("Не удалось запустить редактор", error);
    const banner = document.querySelector('[data-workspace-target="banner"]');
    banner.querySelector("div").textContent =
      "Не удалось загрузить редактор. Проверьте подключение к интернету, затем обновите страницу.";
    banner.classList.add("visible");
    document.querySelector(".app").classList.add("fallback-mode");
    for (const button of document.querySelectorAll("[data-action]")) {
      button.disabled = true;
    }
  }
}
