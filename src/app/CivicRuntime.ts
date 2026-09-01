import { LandHousingUiController } from "../ui/LandHousingUiController.ts";
import { UrbanFabricUiController } from "../ui/UrbanFabricUiController.ts";
import { GameApp } from "./GameApp.ts";

export class CivicRuntime {
  readonly app: GameApp;
  readonly urbanFabricUi: UrbanFabricUiController;
  readonly landHousingUi: LandHousingUiController;
  private disposed = false;

  constructor(private readonly root: HTMLElement) {
    this.app = new GameApp(root);
    this.urbanFabricUi = new UrbanFabricUiController(this.app, root);
    this.landHousingUi = new LandHousingUiController(this.app, root);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.landHousingUi.dispose();
    this.urbanFabricUi.dispose();
    await this.app.dispose();
    this.root.replaceChildren();
  }
}
