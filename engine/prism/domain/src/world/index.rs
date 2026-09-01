use std::cmp::Ordering;

use crate::cadastre::types::WorldPoint;
use crate::error::P2AError;

use super::import::WorldMirror;
use super::types::{GeographyEntity, GeographyKind, TerrainPhysicalSample};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HydrologySample<'a> {
    pub conditioned_elevation_meters: f64,
    pub watershed_id: &'a str,
    pub flow_accumulation: f64,
    pub flood_susceptibility: f64,
}

#[derive(Clone, Debug, PartialEq)]
struct AabbEntry {
    id: String,
    entity_index: usize,
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

impl WorldMirror {
    pub fn terrain_sample_at(&self, x: u32, y: u32) -> Result<&TerrainPhysicalSample, P2AError> {
        let terrain = &self.snapshot().terrain;
        let index = checked_grid_index(terrain.width, terrain.height, x, y, "terrain")?;
        terrain.samples.get(index).ok_or_else(|| {
            world_query_error(
                "query-out-of-bounds",
                "terrain sample index escaped validated grid",
            )
        })
    }

    pub fn hydrology_sample_at(&self, x: u32, y: u32) -> Result<HydrologySample<'_>, P2AError> {
        let hydrology = &self.snapshot().hydrology;
        let index = checked_grid_index(hydrology.width, hydrology.height, x, y, "hydrology")?;
        Ok(HydrologySample {
            conditioned_elevation_meters: hydrology.conditioned_elevation_meters[index],
            watershed_id: hydrology.watershed_ids[index].as_str(),
            flow_accumulation: hydrology.flow_accumulation[index],
            flood_susceptibility: hydrology.flood_susceptibility[index],
        })
    }

    pub fn flood_depth_at(&self, x: u32, y: u32) -> Result<f64, P2AError> {
        let terrain = &self.snapshot().terrain;
        let index = checked_grid_index(terrain.width, terrain.height, x, y, "flood")?;
        Ok(self
            .snapshot()
            .last_flood_result
            .as_ref()
            .map_or(0.0, |flood| flood.depth_meters[index]))
    }

    #[must_use]
    pub fn geography_by_id(&self, id: &str) -> Option<&GeographyEntity> {
        self.snapshot()
            .geography
            .entities
            .iter()
            .find(|entity| entity.id == id)
    }

    #[must_use]
    pub fn geography_at(
        &self,
        point: WorldPoint,
        kind: Option<GeographyKind>,
    ) -> Option<&GeographyEntity> {
        if !point.x.is_finite() || !point.y.is_finite() {
            return None;
        }

        self.snapshot()
            .geography
            .entities
            .iter()
            .filter(|entity| kind.is_none_or(|kind| entity.kind == kind))
            .filter(|entity| point_in_polygon(point, entity))
            .min_by(|left, right| {
                geography_depth(right.kind)
                    .cmp(&geography_depth(left.kind))
                    .then_with(|| left.id.cmp(&right.id))
            })
    }

    pub fn geography_ids_in_aabb(
        &self,
        min_x: f64,
        min_y: f64,
        max_x: f64,
        max_y: f64,
        kind: Option<GeographyKind>,
    ) -> Result<Vec<String>, P2AError> {
        validate_aabb(min_x, min_y, max_x, max_y, "geography")?;
        let entities = &self.snapshot().geography.entities;
        let mut index = entities
            .iter()
            .enumerate()
            .map(|(entity_index, entity)| {
                let (entity_min_x, entity_min_y, entity_max_x, entity_max_y) =
                    polygon_bounds(entity);
                AabbEntry {
                    id: entity.id.clone(),
                    entity_index,
                    min_x: entity_min_x,
                    min_y: entity_min_y,
                    max_x: entity_max_x,
                    max_y: entity_max_y,
                }
            })
            .collect::<Vec<_>>();
        index.sort_by(|left, right| left.id.cmp(&right.id));

        let mut matches = index
            .iter()
            .filter(|entry| aabb_overlaps(entry, min_x, min_y, max_x, max_y))
            .map(|entry| &entities[entry.entity_index])
            .filter(|entity| kind.is_none_or(|kind| entity.kind == kind))
            .collect::<Vec<_>>();
        matches.sort_by(|left, right| {
            left.sort_key
                .cmp(&right.sort_key)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(matches
            .into_iter()
            .map(|entity| entity.id.clone())
            .collect())
    }
}

fn checked_grid_index(
    width: u32,
    height: u32,
    x: u32,
    y: u32,
    field: &str,
) -> Result<usize, P2AError> {
    if x >= width || y >= height {
        return Err(world_query_error(
            "query-out-of-bounds",
            format!("{field} coordinate ({x},{y}) is outside {width}x{height}"),
        ));
    }
    let index = u64::from(y)
        .checked_mul(u64::from(width))
        .and_then(|row| row.checked_add(u64::from(x)))
        .ok_or_else(|| world_query_error("query-index-overflow", field))?;
    usize::try_from(index).map_err(|_| world_query_error("query-index-overflow", field))
}

fn validate_aabb(
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
    field: &str,
) -> Result<(), P2AError> {
    if [min_x, min_y, max_x, max_y]
        .into_iter()
        .any(|value| !value.is_finite())
        || min_x > max_x
        || min_y > max_y
    {
        return Err(world_query_error("query-invalid-aabb", field));
    }
    Ok(())
}

fn polygon_bounds(entity: &GeographyEntity) -> (f64, f64, f64, f64) {
    let first = entity
        .boundary
        .points
        .first()
        .expect("validated geography polygons are non-empty");
    entity.boundary.points.iter().skip(1).fold(
        (first.x, first.y, first.x, first.y),
        |(min_x, min_y, max_x, max_y), point| {
            (
                min_x.min(point.x),
                min_y.min(point.y),
                max_x.max(point.x),
                max_y.max(point.y),
            )
        },
    )
}

fn aabb_overlaps(entry: &AabbEntry, min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> bool {
    entry.min_x <= max_x && entry.max_x >= min_x && entry.min_y <= max_y && entry.max_y >= min_y
}

fn geography_depth(kind: GeographyKind) -> u8 {
    match kind {
        GeographyKind::Region => 0,
        GeographyKind::Municipality => 1,
        GeographyKind::District => 2,
        GeographyKind::Neighborhood => 3,
        GeographyKind::Block => 4,
    }
}

fn point_in_polygon(point: WorldPoint, entity: &GeographyEntity) -> bool {
    let points = &entity.boundary.points;
    if points
        .iter()
        .zip(points.iter().cycle().skip(1))
        .take(points.len())
        .any(|(start, end)| point_on_segment(point, start.x, start.y, end.x, end.y))
    {
        return true;
    }

    let mut inside = false;
    for (start, end) in points
        .iter()
        .zip(points.iter().cycle().skip(1))
        .take(points.len())
    {
        let crosses = (start.y > point.y) != (end.y > point.y);
        if crosses {
            let x_intersection =
                (end.x - start.x) * (point.y - start.y) / (end.y - start.y) + start.x;
            if point.x < x_intersection {
                inside = !inside;
            }
        }
    }
    inside
}

fn point_on_segment(point: WorldPoint, start_x: f64, start_y: f64, end_x: f64, end_y: f64) -> bool {
    const EPSILON: f64 = 1.0e-9;
    let cross = (point.y - start_y) * (end_x - start_x) - (point.x - start_x) * (end_y - start_y);
    if cross.abs() > EPSILON {
        return false;
    }
    let dot = (point.x - start_x) * (end_x - start_x) + (point.y - start_y) * (end_y - start_y);
    if dot < -EPSILON {
        return false;
    }
    let length_squared = (end_x - start_x).mul_add(end_x - start_x, (end_y - start_y).powi(2));
    dot <= length_squared + EPSILON
}

fn world_query_error(code: &'static str, field: impl Into<String>) -> P2AError {
    P2AError::WorldValidation {
        code,
        field: field.into(),
    }
}

#[allow(dead_code)]
fn total_order(left: f64, right: f64) -> Ordering {
    left.total_cmp(&right)
}
