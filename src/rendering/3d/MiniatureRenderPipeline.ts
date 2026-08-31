import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { VisualTime } from './presentation/PresentationTypes.ts';

export class MiniatureRenderPipeline {
  readonly ambientLight: HemisphericLight;
  readonly keyLight: DirectionalLight;
  readonly pipeline: DefaultRenderingPipeline;

  private readonly scene: Scene;
  private readonly ground = MeshBuilder.CreateGround;
  private readonly groundMesh;
  private readonly groundMaterial: StandardMaterial;

  constructor(scene: Scene, camera: ArcRotateCamera) {
    this.scene = scene;
    this.scene.clearColor = new Color4(0.71, 0.78, 0.79, 1);
    this.scene.ambientColor = new Color3(0.34, 0.36, 0.35);
    this.scene.imageProcessingConfiguration.contrast = 1.04;
    this.scene.imageProcessingConfiguration.exposure = 1.0;

    this.ambientLight = new HemisphericLight('civic-miniature-ambient', new Vector3(0.2, 1, 0.15), scene);
    this.ambientLight.intensity = 0.72;
    this.ambientLight.groundColor = new Color3(0.33, 0.36, 0.34);

    this.keyLight = new DirectionalLight('civic-miniature-sun', new Vector3(-0.55, -1, 0.35), scene);
    this.keyLight.position = new Vector3(350, 700, -250);
    this.keyLight.intensity = 1.45;

    this.groundMesh = this.ground('civic-miniature-ground', {
      width: 10_000,
      height: 10_000,
      subdivisions: 1,
    }, scene);
    this.groundMesh.isPickable = false;
    this.groundMaterial = new StandardMaterial('civic-miniature-ground-material', scene);
    this.groundMaterial.diffuseColor = new Color3(0.48, 0.57, 0.43);
    this.groundMaterial.specularColor = new Color3(0.04, 0.04, 0.04);
    this.groundMaterial.roughness = 0.96;
    this.groundMesh.material = this.groundMaterial;

    this.pipeline = new DefaultRenderingPipeline('civic-miniature-pipeline', true, scene, [camera]);
    this.pipeline.fxaaEnabled = true;
    this.pipeline.bloomEnabled = false;
    this.pipeline.depthOfFieldEnabled = true;
    this.pipeline.depthOfField.fStop = 3.2;
    this.pipeline.depthOfField.focalLength = 45;
    this.pipeline.depthOfField.lensSize = 50;
    this.updateFocusDistance(camera.radius);
  }

  setVisualTime(visualTime: VisualTime): void {
    if (visualTime === 'night') {
      this.scene.clearColor = new Color4(0.055, 0.075, 0.1, 1);
      this.scene.ambientColor = new Color3(0.12, 0.15, 0.19);
      this.ambientLight.intensity = 0.32;
      this.keyLight.intensity = 0.38;
      this.groundMaterial.diffuseColor = new Color3(0.22, 0.28, 0.24);
      this.scene.imageProcessingConfiguration.exposure = 0.88;
      return;
    }

    this.scene.clearColor = new Color4(0.71, 0.78, 0.79, 1);
    this.scene.ambientColor = new Color3(0.34, 0.36, 0.35);
    this.ambientLight.intensity = 0.72;
    this.keyLight.intensity = 1.45;
    this.groundMaterial.diffuseColor = new Color3(0.48, 0.57, 0.43);
    this.scene.imageProcessingConfiguration.exposure = 1.0;
  }

  updateFocusDistance(distanceMeters: number): void {
    this.pipeline.depthOfField.focusDistance = Math.max(1_000, distanceMeters * 1_000);
  }

  dispose(): void {
    this.pipeline.dispose();
    this.groundMesh.dispose();
    this.groundMaterial.dispose();
    this.keyLight.dispose();
    this.ambientLight.dispose();
  }
}
