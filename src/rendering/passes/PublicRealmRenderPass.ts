import type { SimulationCore } from '../../simulation/core/SimulationCore.ts';
import { AssetRegistry } from '../assets/AssetRegistry.ts';
import { SpritePainter } from '../assets/SpritePainter.ts';
import type { AssetManifestEntry } from '../assets/AssetTypes.ts';
import { IsometricCamera } from '../isometric/IsometricCamera.ts';
import { isProjectedSpriteVisible, type Viewport } from '../isometric/IsometricCulling.ts';
import { rotateWorldPoint, type WorldSize } from '../isometric/IsometricProjection.ts';
import {
  buildPublicRealmAssetCatalog,
  resolvePublicRealmVisual,
  type PublicRealmAssetCatalog,
  type PublicRealmVisualSelection,
} from '../public-realm/PublicRealmAssetResolver.ts';
import {
  PublicRealmPresentationCache,
  type PublicRealmPresentationSnapshot,
} from '../public-realm/PublicRealmPresentationCache.ts';
import type { PublicRealmDescriptor, RealmAnchor } from '../public-realm/PublicRealmTypes.ts';
import { makeDepthKey, type SceneLayer } from './RenderOrder.ts';
import type { SceneSpriteCommand } from './SceneSpriteCommand.ts';

export type PublicRealmResolvedVisual = Readonly<{
  descriptor: PublicRealmDescriptor;
  selection: PublicRealmVisualSelection;
}>;

export type PublicRealmFrame = Readonly<{
  presentation: PublicRealmPresentationSnapshot;
  visuals: readonly PublicRealmResolvedVisual[];
  worldSize: WorldSize;
}>;

export class PublicRealmRenderPass {
  private readonly cache = new PublicRealmPresentationCache();
  private readonly catalog: PublicRealmAssetCatalog;
  private readonly painter = new SpritePainter();
  private readonly assets: AssetRegistry;

  constructor(assets: AssetRegistry) {
    this.assets = assets;
    this.catalog = buildPublicRealmAssetCatalog(this.assets.query({ category: 'public-realm' }));
  }

  resolveFrame(core: SimulationCore, camera: IsometricCamera): PublicRealmFrame {
    const presentation = this.cache.resolve(core);
    const visuals = Object.freeze(presentation.descriptors.map((descriptor) => Object.freeze({
      descriptor,
      selection: resolvePublicRealmVisual(descriptor, camera.quarterTurns, this.catalog),
    })));
    return Object.freeze({
      presentation,
      visuals,
      worldSize: Object.freeze({ width: core.terrain.width, height: core.terrain.height }),
    });
  }

  drawSurfaces(
    ctx: CanvasRenderingContext2D,
    frame: PublicRealmFrame,
    camera: IsometricCamera,
    viewport: Viewport,
    worldSize: WorldSize,
  ): void {
    const sourceScale = 0.5 * camera.zoom;
    for (const visual of frame.visuals) {
      for (const entry of visual.selection.surface) {
        const anchor = surfaceAnchor(visual.descriptor, entry);
        const center = camera.worldToCanvas(anchor.x, anchor.y, worldSize);
        if (!isProjectedSpriteVisible(center, entry, sourceScale, viewport)) continue;
        this.painter.draw(
          ctx,
          this.assets.resolveAssetId(entry.assetId),
          center,
          sourceScale,
          { footprintWidth: entry.footprint.width, footprintHeight: entry.footprint.height, label: 'PR' },
        );
      }
    }
  }

  collectVertical(frame: PublicRealmFrame, camera: IsometricCamera): readonly SceneSpriteCommand[] {
    const commands: SceneSpriteCommand[] = [];
    for (const visual of frame.visuals) {
      for (const entry of visual.selection.vertical) {
        const anchor = verticalAnchor(visual.descriptor, entry);
        const rotated = rotateWorldPoint(anchor.x, anchor.y, frame.worldSize, camera.quarterTurns);
        commands.push(Object.freeze({
          depth: makeDepthKey(sceneLayerFor(entry), rotated.x, rotated.y, 0, `${visual.descriptor.context.selectionKey}|${entry.assetId}`),
          entry,
          assetId: entry.assetId,
          x: anchor.x,
          y: anchor.y,
          label: 'PR',
          footprintWidth: entry.footprint.width,
          footprintHeight: entry.footprint.height,
        }));
      }
    }
    return Object.freeze(commands);
  }
}

function surfaceAnchor(descriptor: PublicRealmDescriptor, entry: AssetManifestEntry): RealmAnchor {
  const key = entry.variantKey;
  if (
    key.includes('parking_surface')
    || key.includes('parking_landscaped')
    || key.includes('plaza')
    || key.includes('forecourt')
    || key.includes('small_square')
    || key.includes('cafe_market')
  ) return descriptor.context.siteAnchor;
  return descriptor.context.frontageAnchor;
}

function verticalAnchor(descriptor: PublicRealmDescriptor, entry: AssetManifestEntry): RealmAnchor {
  if (entry.variantKey.includes('fountain_plinth')) return descriptor.context.siteAnchor;
  return descriptor.context.frontageAnchor;
}

function sceneLayerFor(entry: AssetManifestEntry): SceneLayer {
  const key = entry.variantKey;
  if (
    key.includes('bench')
    || key.includes('bollard')
    || key.includes('bin_')
    || key.includes('hedge')
    || key.includes('planter')
    || key.includes('hydrant')
    || key.includes('tree_pit')
    || key.includes('median_planting')
  ) return 'low-props';
  return 'objects';
}
