from __future__ import annotations

DIMS = {'public_realm': (2048, 1152)}
FRAME_W = 128
FRAME_H = 192
COLUMNS = 16

SURFACES = [
    'realm_sidewalk_concrete_01','realm_sidewalk_paver_01','realm_plaza_stone_01',
    'realm_plaza_concrete_01','realm_permeable_pavers_01','realm_grass_verge_01',
]
ACCESS = [
    'realm_curb_standard_01','realm_curb_ramp_01','realm_driveway_cut_01',
    'realm_service_apron_01','realm_loading_apron_01','realm_parking_lot_entrance_01',
]
FURNITURE_DIRECTIONAL = ['realm_bench_01']
FURNITURE_SYMMETRIC = [
    'realm_ped_lamp_01','realm_road_lamp_01','realm_bollards_01',
    'realm_planter_01','realm_bin_01','realm_hydrant_01',
]
VEGETATION = [
    'realm_tree_pit_01','realm_tree_pit_02',
    'realm_tree_young_01','realm_tree_young_02','realm_tree_young_03',
    'realm_tree_mature_01','realm_tree_mature_02','realm_tree_mature_03','realm_tree_mature_04',
    'realm_tree_ornamental_01','realm_tree_ornamental_02','realm_tree_ornamental_03',
    'realm_hedge_01','realm_hedge_02',
    'realm_median_planting_01','realm_median_planting_02','realm_median_planting_03',
]
PARKING = [
    'realm_parking_surface_01','realm_parking_landscaped_edge_01',
    'realm_garage_structured_entry_01','realm_garage_podium_entry_01','realm_curbside_cars_01',
]
PUBLIC_SPACE = [
    'realm_pocket_plaza_01','realm_pocket_plaza_02',
    'realm_civic_forecourt_01','realm_civic_forecourt_02',
    'realm_commercial_forecourt_01','realm_commercial_forecourt_02',
    'realm_small_square_01','realm_small_square_02',
    'realm_cafe_market_01','realm_cafe_market_02','realm_cafe_market_03',
    'realm_fountain_plinth_01','realm_fountain_plinth_02',
]


def _root(body: list[str]) -> str:
    width, height = DIMS['public_realm']
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">' + ''.join(body) + '</svg>'


def _origin(slot: int) -> tuple[int, int]:
    return (slot % COLUMNS) * FRAME_W, (slot // COLUMNS) * FRAME_H


def _diamond(fill: str, stroke: str = '#6e716d') -> str:
    return f'<polygon points="64,112 116,138 64,164 12,138" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>'


def _direction_endpoint(orientation: int) -> tuple[int, int]:
    return [(64, 112), (116, 138), (64, 164), (12, 138)][orientation % 4]


def _surface_sprite(name: str) -> str:
    fill = '#b8b4aa'
    if 'paver' in name: fill = '#b59f8d'
    elif 'stone' in name: fill = '#aaa79f'
    elif 'permeable' in name: fill = '#9aa58d'
    elif 'grass' in name: fill = '#789168'
    body = [_diamond(fill)]
    if 'paver' in name or 'stone' in name or 'permeable' in name:
        body.append('<path d="M22,137L64,116L106,137M22,145L64,124L106,145M42,128L84,149M58,120L100,141" fill="none" stroke="#d3cdc2" stroke-width="1" opacity=".55"/>')
    return ''.join(body)


def _access_sprite(name: str, orientation: int) -> str:
    ex, ey = _direction_endpoint(orientation)
    width = 9 if 'curb' in name else 16
    color = '#d1ccc2' if 'curb' in name else '#777b7c'
    extra = ''
    if 'ramp' in name: extra = '<polygon points="55,133 64,129 73,133 64,138" fill="#c6bdac"/>'
    if 'loading' in name: extra = '<path d="M42,144L86,122M50,150L94,128" stroke="#d7c56f" stroke-width="2"/>'
    return _diamond('#aaa69d') + f'<path d="M64,138L{ex},{ey}" stroke="{color}" stroke-width="{width}" stroke-linecap="square"/>' + extra


def _bench_sprite(orientation: int) -> str:
    ex, ey = _direction_endpoint(orientation)
    dx, dy = ex - 64, ey - 138
    scale = max(abs(dx), abs(dy), 1)
    px, py = -dy / scale, dx / scale
    x1, y1 = 64 - px * 17, 138 - py * 17
    x2, y2 = 64 + px * 17, 138 + py * 17
    return _diamond('#9aa58d') + f'<path d="M{x1:.1f},{y1:.1f}L{x2:.1f},{y2:.1f}" stroke="#6f5844" stroke-width="7"/><path d="M{x1:.1f},{y1-6:.1f}L{x2:.1f},{y2-6:.1f}" stroke="#846b52" stroke-width="5"/>'


def _furniture_sprite(name: str) -> str:
    ground = _diamond('#9ba68f')
    if 'lamp' in name:
        top = 68 if 'road' in name else 78
        return ground + f'<path d="M64,140V{top}" stroke="#424b50" stroke-width="4"/><ellipse cx="64" cy="{top}" rx="8" ry="4" fill="#e8d7a1"/>'
    if 'bollards' in name:
        return ground + ''.join(f'<rect x="{x}" y="124" width="5" height="20" rx="2" fill="#50595d"/>' for x in (42, 58, 74, 90))
    if 'planter' in name:
        return ground + '<polygon points="45,128 64,137 83,128 83,143 64,152 45,143" fill="#817265"/><ellipse cx="64" cy="126" rx="17" ry="9" fill="#627b58"/>'
    if 'bin' in name:
        return ground + '<rect x="57" y="113" width="14" height="30" rx="3" fill="#596469"/><rect x="55" y="109" width="18" height="6" rx="2" fill="#424b50"/>'
    return ground + '<path d="M64,143V112" stroke="#a65a45" stroke-width="7"/><path d="M56,116h16" stroke="#d0b29f" stroke-width="4"/>'


def _vegetation_sprite(name: str, variant: int) -> str:
    ground = _diamond('#8ca078')
    if 'hedge' in name:
        return ground + '<ellipse cx="64" cy="128" rx="36" ry="15" fill="#5f7854"/><ellipse cx="64" cy="122" rx="31" ry="12" fill="#708b62"/>'
    if 'median' in name:
        return ground + '<ellipse cx="64" cy="137" rx="38" ry="10" fill="#657f59"/>' + ''.join(f'<circle cx="{x}" cy="132" r="5" fill="#87a173"/>' for x in (42, 55, 69, 84))
    if 'pit' in name:
        return ground + '<polygon points="64,126 82,135 64,144 46,135" fill="#5f625c"/><circle cx="64" cy="135" r="7" fill="#735b43"/>'
    mature = 'mature' in name
    ornamental = 'ornamental' in name
    canopy_y = 82 if mature else 96
    canopy_rx = 28 if mature else 20
    canopy_ry = 30 if mature else 23
    if ornamental:
        canopy_rx, canopy_ry = 23, 25
    greens = ['#62805a', '#6f8c62', '#59764f', '#748f67']
    green = greens[variant % len(greens)]
    return ground + f'<ellipse cx="64" cy="143" rx="22" ry="7" fill="#29342d" opacity=".16"/><rect x="61" y="{canopy_y+18}" width="6" height="42" fill="#6f5945"/><ellipse cx="64" cy="{canopy_y}" rx="{canopy_rx}" ry="{canopy_ry}" fill="{green}"/><ellipse cx="55" cy="{canopy_y-8}" rx="12" ry="15" fill="#829b73" opacity=".75"/>'


def _parking_sprite(name: str, orientation: int) -> str:
    ex, ey = _direction_endpoint(orientation)
    ground = _diamond('#666c70', '#858a8a')
    if 'garage' in name:
        wall = '#9a9d98' if 'structured' in name else '#b4aaa0'
        return ground + f'<polygon points="34,76 64,91 94,76 94,131 64,146 34,131" fill="{wall}"/><polygon points="64,91 94,76 94,131 64,146" fill="#858b88"/><rect x="67" y="103" width="21" height="25" fill="#363d41"/><path d="M64,138L{ex},{ey}" stroke="#d5d1c7" stroke-width="3"/>'
    if 'curbside' in name:
        return ground + '<g transform="translate(37,122)"><polygon points="0,9 18,0 37,9 19,18" fill="#667f91"/><polygon points="8,7 18,2 29,7 19,12" fill="#a9bac2"/></g>'
    landscaped = 'landscaped' in name
    extra = '<ellipse cx="64" cy="119" rx="30" ry="7" fill="#687f5a"/>' if landscaped else ''
    return ground + '<path d="M32,128L61,143M49,120L78,135M66,112L95,127" stroke="#e2ded3" stroke-width="2"/>' + extra


def _public_space_sprite(name: str, variant: int) -> str:
    base = _diamond('#b7afa3')
    if 'fountain' in name:
        return base + '<ellipse cx="64" cy="132" rx="24" ry="11" fill="#798c91"/><ellipse cx="64" cy="129" rx="18" ry="7" fill="#7fa5b7"/><path d="M64,128V98" stroke="#92bed0" stroke-width="3"/><ellipse cx="64" cy="98" rx="4" ry="2" fill="#c2e0e8"/>'
    if 'cafe' in name:
        return base + '<path d="M48,126V103M80,126V103" stroke="#695646" stroke-width="3"/><path d="M37,105H91L79,119H49Z" fill="#a86d55"/><circle cx="45" cy="139" r="7" fill="#6d5949"/><circle cx="84" cy="139" r="7" fill="#6d5949"/>'
    if 'civic' in name:
        return base + '<path d="M32,137L64,121L96,137" fill="none" stroke="#d9d2c7" stroke-width="4"/><rect x="60" y="101" width="8" height="26" fill="#777a77"/>'
    if 'commercial' in name:
        return base + '<rect x="40" y="126" width="48" height="7" fill="#8d765e"/><circle cx="48" cy="119" r="8" fill="#6f8a61"/><circle cx="81" cy="119" r="8" fill="#6f8a61"/>'
    return base + '<ellipse cx="64" cy="134" rx="26" ry="9" fill="#8c9b7c" opacity=".7"/><circle cx="64" cy="119" r="8" fill="#6f875f"/>'


def public_realm() -> str:
    body: list[str] = []
    slot = 0

    def add(sprite: str) -> None:
        nonlocal slot
        x, y = _origin(slot)
        body.append(f'<g transform="translate({x},{y})">{sprite}</g>')
        slot += 1

    for name in SURFACES:
        add(_surface_sprite(name))
    for name in ACCESS:
        for orientation in range(4):
            add(_access_sprite(name, orientation))
    for name in FURNITURE_DIRECTIONAL:
        for orientation in range(4):
            add(_bench_sprite(orientation))
    for name in FURNITURE_SYMMETRIC:
        add(_furniture_sprite(name))
    for index, name in enumerate(VEGETATION):
        add(_vegetation_sprite(name, index))
    for name in PARKING:
        for orientation in range(4):
            add(_parking_sprite(name, orientation))
    for index, name in enumerate(PUBLIC_SPACE):
        add(_public_space_sprite(name, index))

    if slot != 90:
        raise AssertionError(f'public realm sheet expected 90 frames, got {slot}')
    return _root(body)


def build_svg_sheet(name: str) -> str:
    if name != 'public_realm':
        raise KeyError(name)
    return public_realm()
