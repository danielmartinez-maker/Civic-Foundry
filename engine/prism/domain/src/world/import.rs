use std::collections::{HashMap, HashSet};

use crate::error::P2AError;

use super::types::{
    FloodResult, GeographyEntity, GeographyKind, GeographySnapshot, HydrologySnapshot,
    LegacyTerrainSnapshot, Polygon2, TerrainFieldSnapshot, TerrainPhysicalSample, Vec2,
    WorldFoundationSnapshot,
};

const GEOMETRY_EPSILON: f64 = 1.0e-9;

#[derive(Clone, Debug, PartialEq)]
pub struct WorldMirror {
    snapshot: WorldFoundationSnapshot,
}

impl WorldMirror {
    #[must_use]
    pub fn snapshot(&self) -> &WorldFoundationSnapshot {
        &self.snapshot
    }
}

impl TryFrom<WorldFoundationSnapshot> for WorldMirror {
    type Error = P2AError;

    fn try_from(mut snapshot: WorldFoundationSnapshot) -> Result<Self, Self::Error> {
        validate_terrain(&snapshot.terrain)?;
        validate_hydrology(&snapshot.terrain, &snapshot.hydrology)?;
        validate_legacy_compatibility(snapshot.legacy_compatibility.as_ref())?;
        validate_flood_result(&snapshot.terrain, snapshot.last_flood_result.as_ref())?;
        validate_geography(&snapshot.geography)?;

        snapshot
            .geography
            .entities
            .sort_by(|left, right| left.sort_key.cmp(&right.sort_key).then(left.id.cmp(&right.id)));

        Ok(Self { snapshot })
    }
}

fn world_error(code: &'static str, detail: impl Into<String>) -> P2AError {
    P2AError::WorldValidation {
        code,
        detail: detail.into(),
    }
}

fn checked_cell_count(width: u32, height: u32, label: &str) -> Result<usize, P2AError> {
    if width == 0 || height == 0 {
        return Err(world_error(
            "invalid-dimensions",
            format!("{label} dimensions must be positive, found {width}x{height}"),
        ));
    }

    usize::try_from(u64::from(width) * u64::from(height)).map_err(|_| {
        world_error(
            "invalid-dimensions",
            format!("{label} dimensions overflow host address space: {width}x{height}"),
        )
    })
}

fn validate_terrain(terrain: &TerrainFieldSnapshot) -> Result<(), P2AError> {
    let expected = checked_cell_count(terrain.width, terrain.height, "terrain")?;
    if !terrain.meters_per_cell.is_finite() || terrain.meters_per_cell <= 0.0 {
        return Err(world_error(
            "invalid-meter-scale",
            "terrain metersPerCell must be finite and positive",
        ));
    }
    if terrain.samples.len() != expected {
        return Err(world_error(
            "terrain-length-mismatch",
            format!(
                "terrain sample length {} does not match dimensions {}x{}",
                terrain.samples.len(),
                terrain.width,
                terrain.height
            ),
        ));
    }

    for (index, sample) in terrain.samples.iter().enumerate() {
        validate_terrain_sample(index, sample)?;
    }
    Ok(())
}

fn validate_terrain_sample(index: usize, sample: &TerrainPhysicalSample) -> Result<(), P2AError> {
    let finite = [
        ("elevationMeters", sample.elevation_meters),
        ("slope", sample.slope),
        ("aspectRadians", sample.aspect_radians),
        ("soilDepthMeters", sample.soil_depth_meters),
        ("bearingCapacityKpa", sample.bearing_capacity_kpa),
        ("bedrockDepthMeters", sample.bedrock_depth_meters),
        ("groundwaterDepthMeters", sample.groundwater_depth_meters),
        ("contaminationIndex", sample.contamination_index),
        (
            "landPreparationMultiplier",
            sample.land_preparation_multiplier,
        ),
    ];
    for (field, value) in finite {
        if !value.is_finite() {
            return Err(world_error(
                "non-finite-terrain",
                format!("terrain sample {index} field {field} is non-finite"),
            ));
        }
    }

    if sample.slope < 0.0
        || sample.soil_depth_meters < 0.0
        || sample.bearing_capacity_kpa <= 0.0
        || sample.bedrock_depth_meters < 0.0
        || sample.groundwater_depth_meters < 0.0
        || !(0.0..=1.0).contains(&sample.contamination_index)
        || sample.land_preparation_multiplier <= 0.0
    {
        return Err(world_error(
            "invalid-terrain-physical-value",
            format!("terrain sample {index} violates physical value bounds"),
        ));
    }

    Ok(())
}

fn validate_hydrology(
    terrain: &TerrainFieldSnapshot,
    hydrology: &HydrologySnapshot,
) -> Result<(), P2AError> {
    if hydrology.width != terrain.width || hydrology.height != terrain.height {
        return Err(world_error(
            "dimension-mismatch",
            format!(
                "hydrology dimensions {}x{} do not match terrain {}x{}",
                hydrology.width, hydrology.height, terrain.width, terrain.height
            ),
        ));
    }
    let expected = checked_cell_count(hydrology.width, hydrology.height, "hydrology")?;
    let lengths = [
        (
            "conditionedElevationMeters",
            hydrology.conditioned_elevation_meters.len(),
        ),
        ("receiver", hydrology.receiver.len()),
        ("flowAccumulation", hydrology.flow_accumulation.len()),
        ("watershedIds", hydrology.watershed_ids.len()),
        ("floodSusceptibility", hydrology.flood_susceptibility.len()),
    ];
    for (field, actual) in lengths {
        if actual != expected {
            return Err(world_error(
                "hydrology-length-mismatch",
                format!("hydrology field {field} length {actual} does not match {expected}"),
            ));
        }
    }

    for (index, value) in hydrology.conditioned_elevation_meters.iter().enumerate() {
        if !value.is_finite() {
            return Err(world_error(
                "non-finite-hydrology",
                format!("conditioned elevation at {index} is non-finite"),
            ));
        }
    }
    for (index, value) in hydrology.flow_accumulation.iter().enumerate() {
        if !value.is_finite() || *value < 0.0 {
            return Err(world_error(
                "invalid-hydrology-value",
                format!("flow accumulation at {index} must be finite and non-negative"),
            ));
        }
    }
    for (index, value) in hydrology.flood_susceptibility.iter().enumerate() {
        if !value.is_finite() || !(0.0..=1.0).contains(value) {
            return Err(world_error(
                "invalid-hydrology-value",
                format!("flood susceptibility at {index} must be finite in [0,1]"),
            ));
        }
    }
    for (index, receiver) in hydrology.receiver.iter().enumerate() {
        if receiver.is_some_and(|receiver| usize::try_from(receiver).map_or(true, |r| r >= expected)) {
            return Err(world_error(
                "invalid-hydrology-receiver",
                format!("receiver at {index} points outside the hydrology grid"),
            ));
        }
    }

    let channel_ids: HashSet<&str> = hydrology.channels.iter().map(|channel| channel.id.as_str()).collect();
    if channel_ids.len() != hydrology.channels.len() {
        return Err(world_error(
            "duplicate-channel-id",
            "hydrology channel IDs must be unique",
        ));
    }
    for channel in &hydrology.channels {
        let from = usize::try_from(channel.from_index).unwrap_or(usize::MAX);
        let to = usize::try_from(channel.to_index).unwrap_or(usize::MAX);
        if channel.id.is_empty()
            || from >= expected
            || to >= expected
            || !channel.accumulation.is_finite()
            || channel.accumulation < 0.0
            || !channel.capacity_volume_m3.is_finite()
            || channel.capacity_volume_m3 < 0.0
        {
            return Err(world_error(
                "invalid-channel",
                format!("hydrology channel {} is invalid", channel.id),
            ));
        }
    }

    let watershed_ids: HashSet<&str> = hydrology
        .watersheds
        .iter()
        .map(|watershed| watershed.id.as_str())
        .collect();
    if watershed_ids.len() != hydrology.watersheds.len() {
        return Err(world_error(
            "duplicate-watershed-id",
            "hydrology watershed IDs must be unique",
        ));
    }
    for watershed in &hydrology.watersheds {
        if watershed.id.is_empty()
            || usize::try_from(watershed.outlet_index).map_or(true, |outlet| outlet >= expected)
            || watershed
                .primary_channel_id
                .as_deref()
                .is_some_and(|id| !channel_ids.contains(id))
        {
            return Err(world_error(
                "invalid-watershed",
                format!("hydrology watershed {} is invalid", watershed.id),
            ));
        }
    }
    for (index, watershed_id) in hydrology.watershed_ids.iter().enumerate() {
        if !watershed_ids.contains(watershed_id.as_str()) {
            return Err(world_error(
                "invalid-watershed-reference",
                format!("hydrology cell {index} references missing watershed {watershed_id}"),
            ));
        }
    }

    Ok(())
}

fn validate_legacy_compatibility(
    legacy: Option<&LegacyTerrainSnapshot>,
) -> Result<(), P2AError> {
    let Some(legacy) = legacy else {
        return Ok(());
    };
    let expected = checked_cell_count(legacy.width, legacy.height, "legacy terrain")?;
    if legacy.cells.len() != expected {
        return Err(world_error(
            "legacy-length-mismatch",
            format!(
                "legacy terrain cell length {} does not match {expected}",
                legacy.cells.len()
            ),
        ));
    }
    for (index, cell) in legacy.cells.iter().enumerate() {
        if !cell.elevation.is_finite() {
            return Err(world_error(
                "non-finite-legacy-terrain",
                format!("legacy terrain elevation at {index} is non-finite"),
            ));
        }
    }
    Ok(())
}

fn validate_flood_result(
    terrain: &TerrainFieldSnapshot,
    flood: Option<&FloodResult>,
) -> Result<(), P2AError> {
    let Some(flood) = flood else {
        return Ok(());
    };
    let expected = checked_cell_count(terrain.width, terrain.height, "terrain")?;
    if flood.depth_meters.len() != expected {
        return Err(world_error(
            "flood-length-mismatch",
            format!(
                "flood depth length {} does not match terrain cell count {expected}",
                flood.depth_meters.len()
            ),
        ));
    }
    if flood.depth_meters.iter().any(|depth| !depth.is_finite() || *depth < 0.0) {
        return Err(world_error(
            "invalid-flood-value",
            "flood depths must be finite and non-negative",
        ));
    }

    let non_negative = [
        flood.rainfall_volume,
        flood.infiltration_volume,
        flood.retained_channel_surface_volume,
        flood.overbank_flood_volume,
        flood.exported_volume,
    ];
    if non_negative
        .into_iter()
        .any(|value| !value.is_finite() || value < 0.0)
        || !flood.balance_error.is_finite()
    {
        return Err(world_error(
            "invalid-flood-value",
            "flood accounting values must be finite and volumes non-negative",
        ));
    }
    Ok(())
}

fn validate_geography(geography: &GeographySnapshot) -> Result<(), P2AError> {
    if geography.entities.is_empty() {
        return Err(world_error(
            "invalid-geography-root",
            "geography hierarchy requires exactly one region root",
        ));
    }

    let mut by_id = HashMap::with_capacity(geography.entities.len());
    for entity in &geography.entities {
        if entity.id.is_empty() || by_id.insert(entity.id.as_str(), entity).is_some() {
            return Err(world_error(
                "duplicate-geography-id",
                format!("duplicate or empty geography entity ID {}", entity.id),
            ));
        }
        validate_polygon(&entity.boundary).map_err(|detail| {
            world_error(
                "invalid-geography-polygon",
                format!("geography entity {}: {detail}", entity.id),
            )
        })?;
    }

    let roots: Vec<_> = geography
        .entities
        .iter()
        .filter(|entity| entity.parent_id.is_none())
        .collect();
    if roots.len() != 1 || roots[0].kind != GeographyKind::Region {
        return Err(world_error(
            "invalid-geography-root",
            "geography hierarchy requires exactly one parentless region",
        ));
    }

    validate_parent_cycles(geography, &by_id)?;

    for entity in &geography.entities {
        match expected_parent_kind(entity.kind) {
            None => {
                if entity.parent_id.is_some() {
                    return Err(world_error(
                        "invalid-geography-parent",
                        format!("region {} cannot have a parent", entity.id),
                    ));
                }
            }
            Some(expected_kind) => {
                let parent_id = entity.parent_id.as_deref().ok_or_else(|| {
                    world_error(
                        "missing-geography-parent",
                        format!("geography entity {} has no parent", entity.id),
                    )
                })?;
                let parent = by_id.get(parent_id).copied().ok_or_else(|| {
                    world_error(
                        "missing-geography-parent",
                        format!("geography entity {} references missing parent {parent_id}", entity.id),
                    )
                })?;
                if parent.kind != expected_kind {
                    return Err(world_error(
                        "invalid-geography-parent",
                        format!("geography entity {} has parent of the wrong kind", entity.id),
                    ));
                }
                if !polygon_contains_polygon(&parent.boundary, &entity.boundary) {
                    return Err(world_error(
                        "geography-child-outside-parent",
                        format!("geography entity {} extends outside parent {parent_id}", entity.id),
                    ));
                }
            }
        }
    }

    for left_index in 0..geography.entities.len() {
        let left = &geography.entities[left_index];
        for right in geography.entities.iter().skip(left_index + 1) {
            if left.parent_id == right.parent_id
                && left.parent_id.is_some()
                && polygons_materially_overlap(&left.boundary, &right.boundary)
            {
                return Err(world_error(
                    "geography-sibling-overlap",
                    format!("geography siblings {} and {} overlap", left.id, right.id),
                ));
            }
        }
    }

    Ok(())
}

fn validate_parent_cycles(
    geography: &GeographySnapshot,
    by_id: &HashMap<&str, &GeographyEntity>,
) -> Result<(), P2AError> {
    for entity in &geography.entities {
        let mut seen = HashSet::new();
        let mut cursor = Some(entity.id.as_str());
        while let Some(id) = cursor {
            if !seen.insert(id) {
                return Err(world_error(
                    "geography-cycle",
                    format!("geography parent cycle includes {id}"),
                ));
            }
            let current = by_id.get(id).copied().ok_or_else(|| {
                world_error(
                    "missing-geography-parent",
                    format!("geography parent chain references missing entity {id}"),
                )
            })?;
            cursor = current.parent_id.as_deref();
        }
    }
    Ok(())
}

fn expected_parent_kind(kind: GeographyKind) -> Option<GeographyKind> {
    match kind {
        GeographyKind::Region => None,
        GeographyKind::Municipality => Some(GeographyKind::Region),
        GeographyKind::District => Some(GeographyKind::Municipality),
        GeographyKind::Neighborhood => Some(GeographyKind::District),
        GeographyKind::Block => Some(GeographyKind::Neighborhood),
    }
}

fn validate_polygon(polygon: &Polygon2) -> Result<(), &'static str> {
    let points = &polygon.points;
    if points.len() < 3 {
        return Err("polygon requires at least three vertices");
    }
    if points.iter().any(|point| !point.x.is_finite() || !point.y.is_finite()) {
        return Err("polygon contains non-finite coordinates");
    }
    for left in 0..points.len() {
        for right in (left + 1)..points.len() {
            if points_equal(points[left], points[right]) {
                return Err("polygon contains duplicate vertices");
            }
        }
    }
    if polygon_area_signed(polygon).abs() <= GEOMETRY_EPSILON {
        return Err("polygon has zero material area");
    }

    for left in 0..points.len() {
        let left_next = (left + 1) % points.len();
        for right in (left + 1)..points.len() {
            let right_next = (right + 1) % points.len();
            if left == right || left_next == right || right_next == left {
                continue;
            }
            if segments_intersect(points[left], points[left_next], points[right], points[right_next]) {
                return Err("polygon self-intersects");
            }
        }
    }
    Ok(())
}

fn points_equal(left: Vec2, right: Vec2) -> bool {
    (left.x - right.x).abs() <= GEOMETRY_EPSILON
        && (left.y - right.y).abs() <= GEOMETRY_EPSILON
}

fn polygon_area_signed(polygon: &Polygon2) -> f64 {
    polygon
        .points
        .iter()
        .enumerate()
        .map(|(index, current)| {
            let next = polygon.points[(index + 1) % polygon.points.len()];
            current.x * next.y - next.x * current.y
        })
        .sum::<f64>()
        * 0.5
}

fn polygon_centroid(polygon: &Polygon2) -> Vec2 {
    let mut cross_sum = 0.0;
    let mut x_sum = 0.0;
    let mut y_sum = 0.0;
    for (index, current) in polygon.points.iter().enumerate() {
        let next = polygon.points[(index + 1) % polygon.points.len()];
        let cross = current.x * next.y - next.x * current.y;
        cross_sum += cross;
        x_sum += (current.x + next.x) * cross;
        y_sum += (current.y + next.y) * cross;
    }
    Vec2 {
        x: x_sum / (3.0 * cross_sum),
        y: y_sum / (3.0 * cross_sum),
    }
}

fn polygon_contains_polygon(parent: &Polygon2, child: &Polygon2) -> bool {
    child.points.iter().all(|point| point_in_polygon(*point, parent, true))
        && point_in_polygon(polygon_centroid(child), parent, true)
}

fn polygons_materially_overlap(left: &Polygon2, right: &Polygon2) -> bool {
    if left
        .points
        .iter()
        .any(|point| point_in_polygon(*point, right, false))
        || right
            .points
            .iter()
            .any(|point| point_in_polygon(*point, left, false))
        || point_in_polygon(polygon_centroid(left), right, false)
        || point_in_polygon(polygon_centroid(right), left, false)
    {
        return true;
    }

    for left_index in 0..left.points.len() {
        let left_next = (left_index + 1) % left.points.len();
        for right_index in 0..right.points.len() {
            let right_next = (right_index + 1) % right.points.len();
            if segments_properly_cross(
                left.points[left_index],
                left.points[left_next],
                right.points[right_index],
                right.points[right_next],
            ) {
                return true;
            }
        }
    }
    false
}

fn point_in_polygon(point: Vec2, polygon: &Polygon2, include_boundary: bool) -> bool {
    for index in 0..polygon.points.len() {
        let next = (index + 1) % polygon.points.len();
        if point_on_segment(point, polygon.points[index], polygon.points[next]) {
            return include_boundary;
        }
    }

    let mut inside = false;
    let mut previous = polygon.points.len() - 1;
    for current in 0..polygon.points.len() {
        let a = polygon.points[current];
        let b = polygon.points[previous];
        if (a.y > point.y) != (b.y > point.y) {
            let x_intersection = (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
            if point.x < x_intersection {
                inside = !inside;
            }
        }
        previous = current;
    }
    inside
}

fn point_on_segment(point: Vec2, start: Vec2, end: Vec2) -> bool {
    orientation(start, end, point).abs() <= GEOMETRY_EPSILON
        && point.x >= start.x.min(end.x) - GEOMETRY_EPSILON
        && point.x <= start.x.max(end.x) + GEOMETRY_EPSILON
        && point.y >= start.y.min(end.y) - GEOMETRY_EPSILON
        && point.y <= start.y.max(end.y) + GEOMETRY_EPSILON
}

fn orientation(a: Vec2, b: Vec2, c: Vec2) -> f64 {
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

fn segments_intersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2) -> bool {
    if segments_properly_cross(a, b, c, d) {
        return true;
    }
    point_on_segment(a, c, d)
        || point_on_segment(b, c, d)
        || point_on_segment(c, a, b)
        || point_on_segment(d, a, b)
}

fn segments_properly_cross(a: Vec2, b: Vec2, c: Vec2, d: Vec2) -> bool {
    let ab_c = orientation(a, b, c);
    let ab_d = orientation(a, b, d);
    let cd_a = orientation(c, d, a);
    let cd_b = orientation(c, d, b);
    ((ab_c > GEOMETRY_EPSILON && ab_d < -GEOMETRY_EPSILON)
        || (ab_c < -GEOMETRY_EPSILON && ab_d > GEOMETRY_EPSILON))
        && ((cd_a > GEOMETRY_EPSILON && cd_b < -GEOMETRY_EPSILON)
            || (cd_a < -GEOMETRY_EPSILON && cd_b > GEOMETRY_EPSILON))
}
