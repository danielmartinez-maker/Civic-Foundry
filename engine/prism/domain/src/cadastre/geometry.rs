use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

use crate::error::P2AError;

use super::types::{PolygonRing, WorldPoint};

const CENTIMETERS_PER_METER: f64 = 100.0;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash)]
struct IntPoint {
    x: i64,
    y: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Segment {
    from: IntPoint,
    to: IntPoint,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PointLocation {
    Outside,
    Boundary,
    Inside,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Rational {
    num: u128,
    den: u128,
}

impl Rational {
    const ZERO: Self = Self { num: 0, den: 1 };
    const ONE: Self = Self { num: 1, den: 1 };

    fn new(num: i128, den: i128) -> Result<Self, P2AError> {
        if den <= 0 || num < 0 || num > den {
            return Err(geometry_error("invalid-rational-parameter"));
        }
        let num = u128::try_from(num).map_err(|_| geometry_error("geometry-overflow"))?;
        let den = u128::try_from(den).map_err(|_| geometry_error("geometry-overflow"))?;
        let divisor = gcd(num, den);
        Ok(Self {
            num: num / divisor,
            den: den / divisor,
        })
    }
}

impl Ord for Rational {
    fn cmp(&self, other: &Self) -> Ordering {
        compare_fractions(self.num, self.den, other.num, other.den)
    }
}

impl PartialOrd for Rational {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn compare_fractions(
    mut left_num: u128,
    mut left_den: u128,
    mut right_num: u128,
    mut right_den: u128,
) -> Ordering {
    let mut reverse = false;
    loop {
        let left_q = left_num / left_den;
        let right_q = right_num / right_den;
        if left_q != right_q {
            let ordering = left_q.cmp(&right_q);
            return if reverse {
                ordering.reverse()
            } else {
                ordering
            };
        }

        let left_r = left_num % left_den;
        let right_r = right_num % right_den;
        if left_r == 0 || right_r == 0 {
            let ordering = match (left_r == 0, right_r == 0) {
                (true, true) => Ordering::Equal,
                (true, false) => Ordering::Less,
                (false, true) => Ordering::Greater,
                (false, false) => unreachable!(),
            };
            return if reverse {
                ordering.reverse()
            } else {
                ordering
            };
        }

        left_num = left_den;
        left_den = left_r;
        right_num = right_den;
        right_den = right_r;
        reverse = !reverse;
    }
}

fn gcd(mut left: u128, mut right: u128) -> u128 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left.max(1)
}

fn geometry_error(code: &'static str) -> P2AError {
    P2AError::Geometry {
        code,
        entity_id: None,
    }
}

pub fn normalize_point(point: WorldPoint) -> Result<WorldPoint, P2AError> {
    Ok(int_to_world(normalize_int_point(point)?))
}

pub fn normalize_ring(ring: &PolygonRing) -> Result<PolygonRing, P2AError> {
    Ok(normalize_int_ring(ring)?
        .into_iter()
        .map(int_to_world)
        .collect())
}

pub fn polygon_area(ring: &PolygonRing) -> Result<f64, P2AError> {
    let ring = normalize_int_ring(ring)?;
    let area2 = signed_area2(&ring)?;
    Ok((area2.unsigned_abs() as f64) / (2.0 * CENTIMETERS_PER_METER.powi(2)))
}

pub fn ring_self_intersects(ring: &PolygonRing) -> Result<bool, P2AError> {
    let ring = normalize_int_ring(ring)?;
    ring_self_intersects_int(&ring)
}

pub fn point_in_ring(point: WorldPoint, ring: &PolygonRing) -> Result<bool, P2AError> {
    let point = normalize_int_point(point)?;
    let ring = prepare_boolean_ring(ring)?;
    Ok(
        point_location_doubled(i128::from(point.x) * 2, i128::from(point.y) * 2, &ring)?
            != PointLocation::Outside,
    )
}

pub fn ring_contains_ring(outer: &PolygonRing, inner: &PolygonRing) -> Result<bool, P2AError> {
    let remainder = polygon_difference(inner, outer)?;
    Ok(remainder.is_empty())
}

pub fn rings_materially_overlap(left: &PolygonRing, right: &PolygonRing) -> Result<bool, P2AError> {
    for ring in polygon_intersection(left, right)? {
        if polygon_area(&ring)? > 0.0 {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn polygon_intersection(
    subject: &PolygonRing,
    clip: &PolygonRing,
) -> Result<Vec<PolygonRing>, P2AError> {
    boolean_two(subject, clip, BooleanOperation::Intersection)
}

pub fn polygon_difference(
    subject: &PolygonRing,
    clip: &PolygonRing,
) -> Result<Vec<PolygonRing>, P2AError> {
    boolean_two(subject, clip, BooleanOperation::Difference)
}

pub fn polygon_union(rings: &[PolygonRing]) -> Result<Vec<PolygonRing>, P2AError> {
    if rings.is_empty() {
        return Ok(Vec::new());
    }

    let prepared = rings
        .iter()
        .map(prepare_boolean_ring)
        .collect::<Result<Vec<_>, _>>()?;
    let split = split_rings(&prepared)?;
    let mut boundary = BTreeSet::new();

    for (ring_index, segments) in split.iter().enumerate() {
        for segment in segments {
            let mut covered = false;
            for (other_index, other) in prepared.iter().enumerate() {
                if other_index == ring_index {
                    continue;
                }
                if point_location_midpoint(*segment, other)? == PointLocation::Inside {
                    covered = true;
                    break;
                }
            }
            if !covered {
                insert_boundary_segment(&mut boundary, *segment);
            }
        }
    }

    reconstruct_world_rings(boundary)
}

#[derive(Clone, Copy)]
enum BooleanOperation {
    Intersection,
    Difference,
}

fn boolean_two(
    subject: &PolygonRing,
    clip: &PolygonRing,
    operation: BooleanOperation,
) -> Result<Vec<PolygonRing>, P2AError> {
    let subject = prepare_boolean_ring(subject)?;
    let clip = prepare_boolean_ring(clip)?;
    let prepared = vec![subject, clip];
    let split = split_rings(&prepared)?;
    let mut boundary = BTreeSet::new();

    for segment in &split[0] {
        let location = point_location_midpoint(*segment, &prepared[1])?;
        let keep = match operation {
            BooleanOperation::Intersection => location != PointLocation::Outside,
            BooleanOperation::Difference => location != PointLocation::Inside,
        };
        if keep {
            insert_boundary_segment(&mut boundary, *segment);
        }
    }

    for segment in &split[1] {
        let location = point_location_midpoint(*segment, &prepared[0])?;
        let keep = match operation {
            BooleanOperation::Intersection => location != PointLocation::Outside,
            BooleanOperation::Difference => location != PointLocation::Outside,
        };
        if keep {
            let retained = match operation {
                BooleanOperation::Intersection => *segment,
                BooleanOperation::Difference => Segment {
                    from: segment.to,
                    to: segment.from,
                },
            };
            insert_boundary_segment(&mut boundary, retained);
        }
    }

    reconstruct_world_rings(boundary)
}

fn normalize_int_point(point: WorldPoint) -> Result<IntPoint, P2AError> {
    Ok(IntPoint {
        x: normalize_coordinate(point.x)?,
        y: normalize_coordinate(point.y)?,
    })
}

fn normalize_coordinate(value: f64) -> Result<i64, P2AError> {
    if !value.is_finite() {
        return Err(geometry_error("non-finite-coordinate"));
    }
    let scaled = value * CENTIMETERS_PER_METER;
    if !scaled.is_finite() {
        return Err(geometry_error("coordinate-overflow"));
    }

    // ECMAScript Math.round(x) is floor(x + 0.5), including negative half ties.
    let rounded = (scaled + 0.5).floor();
    const I64_MAX_EXCLUSIVE: f64 = 9_223_372_036_854_775_808.0;
    if rounded < i64::MIN as f64 || rounded >= I64_MAX_EXCLUSIVE {
        return Err(geometry_error("coordinate-overflow"));
    }
    Ok(rounded as i64)
}

fn int_to_world(point: IntPoint) -> WorldPoint {
    WorldPoint {
        x: point.x as f64 / CENTIMETERS_PER_METER,
        y: point.y as f64 / CENTIMETERS_PER_METER,
    }
}

fn normalize_int_ring(ring: &PolygonRing) -> Result<Vec<IntPoint>, P2AError> {
    let mut normalized = Vec::with_capacity(ring.len());
    for point in ring {
        let point = normalize_int_point(*point)?;
        if normalized.last().copied() != Some(point) {
            normalized.push(point);
        }
    }
    if normalized.len() > 1 && normalized.first() == normalized.last() {
        normalized.pop();
    }
    if normalized.len() < 3 {
        return Err(geometry_error("ring-too-small"));
    }
    Ok(normalized)
}

fn prepare_boolean_ring(ring: &PolygonRing) -> Result<Vec<IntPoint>, P2AError> {
    let mut ring = normalize_int_ring(ring)?;
    if ring_self_intersects_int(&ring)? {
        return Err(geometry_error("self-intersecting-ring"));
    }
    let area2 = signed_area2(&ring)?;
    if area2 == 0 {
        return Err(geometry_error("zero-area-ring"));
    }
    if area2 < 0 {
        ring.reverse();
    }
    Ok(ring)
}

fn signed_area2(ring: &[IntPoint]) -> Result<i128, P2AError> {
    let mut total = 0_i128;
    for index in 0..ring.len() {
        let current = ring[index];
        let next = ring[(index + 1) % ring.len()];
        let left = i128::from(current.x)
            .checked_mul(i128::from(next.y))
            .ok_or_else(|| geometry_error("geometry-overflow"))?;
        let right = i128::from(next.x)
            .checked_mul(i128::from(current.y))
            .ok_or_else(|| geometry_error("geometry-overflow"))?;
        total = total
            .checked_add(
                left.checked_sub(right)
                    .ok_or_else(|| geometry_error("geometry-overflow"))?,
            )
            .ok_or_else(|| geometry_error("geometry-overflow"))?;
    }
    Ok(total)
}

fn ring_self_intersects_int(ring: &[IntPoint]) -> Result<bool, P2AError> {
    for left in 0..ring.len() {
        let left_next = (left + 1) % ring.len();
        let left_segment = Segment {
            from: ring[left],
            to: ring[left_next],
        };
        for right in (left + 1)..ring.len() {
            let right_next = (right + 1) % ring.len();
            if left == right || left_next == right || right_next == left {
                continue;
            }
            let right_segment = Segment {
                from: ring[right],
                to: ring[right_next],
            };
            if segments_intersect(left_segment, right_segment)? {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn segments_intersect(left: Segment, right: Segment) -> Result<bool, P2AError> {
    let (left_params, right_params) = pair_split_parameters(left, right)?;
    Ok(!left_params.is_empty() || !right_params.is_empty())
}

fn split_rings(rings: &[Vec<IntPoint>]) -> Result<Vec<Vec<Segment>>, P2AError> {
    let mut parameters: Vec<Vec<Vec<Rational>>> = rings
        .iter()
        .map(|ring| {
            (0..ring.len())
                .map(|_| vec![Rational::ZERO, Rational::ONE])
                .collect()
        })
        .collect();

    for left_ring in 0..rings.len() {
        for right_ring in (left_ring + 1)..rings.len() {
            for left_edge in 0..rings[left_ring].len() {
                let left_segment = ring_segment(&rings[left_ring], left_edge);
                for right_edge in 0..rings[right_ring].len() {
                    let right_segment = ring_segment(&rings[right_ring], right_edge);
                    let (left_params, right_params) =
                        pair_split_parameters(left_segment, right_segment)?;
                    parameters[left_ring][left_edge].extend(left_params);
                    parameters[right_ring][right_edge].extend(right_params);
                }
            }
        }
    }

    let mut result = Vec::with_capacity(rings.len());
    for (ring_index, ring) in rings.iter().enumerate() {
        let mut segments = Vec::new();
        for (edge_index, params) in parameters[ring_index].iter_mut().enumerate() {
            let edge = ring_segment(ring, edge_index);
            params.sort_unstable();
            params.dedup();

            for pair in params.windows(2) {
                let from = evaluate_segment(edge, pair[0])?;
                let to = evaluate_segment(edge, pair[1])?;
                if from != to {
                    segments.push(Segment { from, to });
                }
            }
        }
        result.push(segments);
    }
    Ok(result)
}

fn ring_segment(ring: &[IntPoint], index: usize) -> Segment {
    Segment {
        from: ring[index],
        to: ring[(index + 1) % ring.len()],
    }
}

fn pair_split_parameters(
    left: Segment,
    right: Segment,
) -> Result<(Vec<Rational>, Vec<Rational>), P2AError> {
    let left_vector = vector(left.from, left.to);
    let right_vector = vector(right.from, right.to);
    let offset = vector(left.from, right.from);
    let mut denominator = cross(left_vector, right_vector)?;
    let mut left_num = cross(offset, right_vector)?;
    let mut right_num = cross(offset, left_vector)?;

    if denominator != 0 {
        if denominator < 0 {
            denominator = denominator
                .checked_neg()
                .ok_or_else(|| geometry_error("geometry-overflow"))?;
            left_num = left_num
                .checked_neg()
                .ok_or_else(|| geometry_error("geometry-overflow"))?;
            right_num = right_num
                .checked_neg()
                .ok_or_else(|| geometry_error("geometry-overflow"))?;
        }

        if (0..=denominator).contains(&left_num) && (0..=denominator).contains(&right_num) {
            return Ok((
                vec![Rational::new(left_num, denominator)?],
                vec![Rational::new(right_num, denominator)?],
            ));
        }
        return Ok((Vec::new(), Vec::new()));
    }

    if cross(offset, left_vector)? != 0 {
        return Ok((Vec::new(), Vec::new()));
    }

    let mut left_params = Vec::new();
    let mut right_params = Vec::new();

    for point in [right.from, right.to] {
        if let Some(parameter) = parameter_on_segment(point, left)? {
            left_params.push(parameter);
        }
    }
    for point in [left.from, left.to] {
        if let Some(parameter) = parameter_on_segment(point, right)? {
            right_params.push(parameter);
        }
    }

    left_params.sort_unstable();
    left_params.dedup();
    right_params.sort_unstable();
    right_params.dedup();
    Ok((left_params, right_params))
}

fn parameter_on_segment(point: IntPoint, segment: Segment) -> Result<Option<Rational>, P2AError> {
    if !point_on_segment(point, segment)? {
        return Ok(None);
    }

    let dx = i128::from(segment.to.x) - i128::from(segment.from.x);
    let dy = i128::from(segment.to.y) - i128::from(segment.from.y);
    let (mut numerator, mut denominator) = if dx != 0 {
        (i128::from(point.x) - i128::from(segment.from.x), dx)
    } else {
        (i128::from(point.y) - i128::from(segment.from.y), dy)
    };
    if denominator < 0 {
        denominator = denominator
            .checked_neg()
            .ok_or_else(|| geometry_error("geometry-overflow"))?;
        numerator = numerator
            .checked_neg()
            .ok_or_else(|| geometry_error("geometry-overflow"))?;
    }
    Ok(Some(Rational::new(numerator, denominator)?))
}

fn evaluate_segment(segment: Segment, parameter: Rational) -> Result<IntPoint, P2AError> {
    Ok(IntPoint {
        x: evaluate_coordinate(segment.from.x, segment.to.x, parameter)?,
        y: evaluate_coordinate(segment.from.y, segment.to.y, parameter)?,
    })
}

fn evaluate_coordinate(from: i64, to: i64, parameter: Rational) -> Result<i64, P2AError> {
    let numerator =
        i128::try_from(parameter.num).map_err(|_| geometry_error("geometry-overflow"))?;
    let denominator =
        i128::try_from(parameter.den).map_err(|_| geometry_error("geometry-overflow"))?;
    let delta = i128::from(to) - i128::from(from);
    let base = i128::from(from)
        .checked_mul(denominator)
        .ok_or_else(|| geometry_error("geometry-overflow"))?;
    let offset = delta
        .checked_mul(numerator)
        .ok_or_else(|| geometry_error("geometry-overflow"))?;
    let value = base
        .checked_add(offset)
        .ok_or_else(|| geometry_error("geometry-overflow"))?;
    round_ratio_js(value, denominator)
}

fn round_ratio_js(numerator: i128, denominator: i128) -> Result<i64, P2AError> {
    let quotient = numerator.div_euclid(denominator);
    let remainder = numerator.rem_euclid(denominator);
    let threshold = denominator / 2 + denominator % 2;
    let rounded = if remainder >= threshold {
        quotient
            .checked_add(1)
            .ok_or_else(|| geometry_error("geometry-overflow"))?
    } else {
        quotient
    };
    i64::try_from(rounded).map_err(|_| geometry_error("geometry-overflow"))
}

#[derive(Clone, Copy)]
struct IntVector {
    x: i128,
    y: i128,
}

fn vector(from: IntPoint, to: IntPoint) -> IntVector {
    IntVector {
        x: i128::from(to.x) - i128::from(from.x),
        y: i128::from(to.y) - i128::from(from.y),
    }
}

fn cross(left: IntVector, right: IntVector) -> Result<i128, P2AError> {
    let first = left
        .x
        .checked_mul(right.y)
        .ok_or_else(|| geometry_error("geometry-overflow"))?;
    let second = left
        .y
        .checked_mul(right.x)
        .ok_or_else(|| geometry_error("geometry-overflow"))?;
    first
        .checked_sub(second)
        .ok_or_else(|| geometry_error("geometry-overflow"))
}

fn point_on_segment(point: IntPoint, segment: Segment) -> Result<bool, P2AError> {
    if cross(
        vector(segment.from, segment.to),
        vector(segment.from, point),
    )? != 0
    {
        return Ok(false);
    }
    Ok(point.x >= segment.from.x.min(segment.to.x)
        && point.x <= segment.from.x.max(segment.to.x)
        && point.y >= segment.from.y.min(segment.to.y)
        && point.y <= segment.from.y.max(segment.to.y))
}

fn point_location_midpoint(segment: Segment, ring: &[IntPoint]) -> Result<PointLocation, P2AError> {
    let x2 = i128::from(segment.from.x) + i128::from(segment.to.x);
    let y2 = i128::from(segment.from.y) + i128::from(segment.to.y);
    point_location_doubled(x2, y2, ring)
}

fn point_location_doubled(
    x2: i128,
    y2: i128,
    ring: &[IntPoint],
) -> Result<PointLocation, P2AError> {
    for index in 0..ring.len() {
        if point_on_segment_doubled(x2, y2, ring_segment(ring, index))? {
            return Ok(PointLocation::Boundary);
        }
    }

    let mut winding = 0_i32;
    for index in 0..ring.len() {
        let edge = ring_segment(ring, index);
        let from_y2 = i128::from(edge.from.y) * 2;
        let to_y2 = i128::from(edge.to.y) * 2;
        let orientation = orientation_doubled(edge, x2, y2)?;

        if from_y2 <= y2 {
            if to_y2 > y2 && orientation > 0 {
                winding += 1;
            }
        } else if to_y2 <= y2 && orientation < 0 {
            winding -= 1;
        }
    }

    Ok(if winding == 0 {
        PointLocation::Outside
    } else {
        PointLocation::Inside
    })
}

fn point_on_segment_doubled(x2: i128, y2: i128, segment: Segment) -> Result<bool, P2AError> {
    if orientation_doubled(segment, x2, y2)? != 0 {
        return Ok(false);
    }

    let min_x2 = i128::from(segment.from.x.min(segment.to.x)) * 2;
    let max_x2 = i128::from(segment.from.x.max(segment.to.x)) * 2;
    let min_y2 = i128::from(segment.from.y.min(segment.to.y)) * 2;
    let max_y2 = i128::from(segment.from.y.max(segment.to.y)) * 2;
    Ok(x2 >= min_x2 && x2 <= max_x2 && y2 >= min_y2 && y2 <= max_y2)
}

fn orientation_doubled(segment: Segment, x2: i128, y2: i128) -> Result<i128, P2AError> {
    let edge = vector(segment.from, segment.to);
    let point = IntVector {
        x: x2 - i128::from(segment.from.x) * 2,
        y: y2 - i128::from(segment.from.y) * 2,
    };
    cross(edge, point)
}

fn insert_boundary_segment(boundary: &mut BTreeSet<(IntPoint, IntPoint)>, segment: Segment) {
    if segment.from == segment.to {
        return;
    }
    let reverse = (segment.to, segment.from);
    if !boundary.remove(&reverse) {
        boundary.insert((segment.from, segment.to));
    }
}

fn reconstruct_world_rings(
    boundary: BTreeSet<(IntPoint, IntPoint)>,
) -> Result<Vec<PolygonRing>, P2AError> {
    let mut adjacency: BTreeMap<IntPoint, BTreeSet<IntPoint>> = BTreeMap::new();
    for (from, to) in boundary {
        adjacency.entry(from).or_default().insert(to);
    }

    let mut rings = Vec::new();
    while let Some((start, next)) = first_edge(&adjacency) {
        remove_edge(&mut adjacency, start, next);
        let mut ring = vec![start, next];
        let mut current = next;

        while current != start {
            let next = adjacency
                .get(&current)
                .and_then(|targets| targets.iter().next().copied())
                .ok_or_else(|| geometry_error("open-boolean-boundary"))?;
            remove_edge(&mut adjacency, current, next);
            current = next;
            if current != start {
                ring.push(current);
            }
        }

        if ring.len() >= 3
            && let Some(canonical) = canonicalize_int_ring(ring)?
        {
            rings.push(canonical);
        }
    }

    sort_canonical_rings(&mut rings)?;
    Ok(rings
        .into_iter()
        .map(|ring| ring.into_iter().map(int_to_world).collect())
        .collect())
}

fn first_edge(adjacency: &BTreeMap<IntPoint, BTreeSet<IntPoint>>) -> Option<(IntPoint, IntPoint)> {
    let (from, targets) = adjacency.first_key_value()?;
    let to = targets.iter().next()?;
    Some((*from, *to))
}

fn remove_edge(
    adjacency: &mut BTreeMap<IntPoint, BTreeSet<IntPoint>>,
    from: IntPoint,
    to: IntPoint,
) {
    let should_remove_key = if let Some(targets) = adjacency.get_mut(&from) {
        targets.remove(&to);
        targets.is_empty()
    } else {
        false
    };
    if should_remove_key {
        adjacency.remove(&from);
    }
}

fn canonicalize_int_ring(mut ring: Vec<IntPoint>) -> Result<Option<Vec<IntPoint>>, P2AError> {
    if ring.len() < 3 {
        return Ok(None);
    }
    let area2 = signed_area2(&ring)?;
    if area2 == 0 {
        return Ok(None);
    }
    if area2 < 0 {
        ring.reverse();
    }
    let minimum = ring
        .iter()
        .enumerate()
        .min_by_key(|(_, point)| **point)
        .map(|(index, _)| index)
        .ok_or_else(|| geometry_error("ring-too-small"))?;
    ring.rotate_left(minimum);
    Ok(Some(ring))
}

fn sort_canonical_rings(rings: &mut [Vec<IntPoint>]) -> Result<(), P2AError> {
    let mut keyed = Vec::with_capacity(rings.len());
    for ring in rings.iter() {
        keyed.push(signed_area2(ring)?.unsigned_abs());
    }

    let mut order: Vec<usize> = (0..rings.len()).collect();
    order.sort_by(|&left, &right| {
        keyed[right]
            .cmp(&keyed[left])
            .then_with(|| rings[left][0].cmp(&rings[right][0]))
            .then_with(|| rings[left].len().cmp(&rings[right].len()))
            .then_with(|| rings[left].cmp(&rings[right]))
    });

    let sorted = order
        .into_iter()
        .map(|index| rings[index].clone())
        .collect::<Vec<_>>();
    rings.clone_from_slice(&sorted);
    Ok(())
}
