from __future__ import annotations

from html import escape

DIMS = {
    'terrain': (1024, 64), 'roads': (2048, 192), 'buildings': (4096, 2048),
    'construction': (2048, 768), 'civic': (2048, 768), 'utilities': (1024, 512),
    'vegetation': (1024, 512), 'vehicles': (4096, 768),
    'urban_depth_buildings': (2048, 1728),
}


def _root(name: str, body: list[str]) -> str:
    w, h = DIMS[name]
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">' + ''.join(body) + '</svg>'


def terrain() -> str:
    body: list[str] = []
    biomes = [('grass','#7f956e'),('grass','#7f956e'),('forest','#647d59'),('forest','#647d59'),('rock','#7d7f7d'),('rock','#7d7f7d'),('water','#5f88a4'),('water','#5f88a4')]
    for i, (kind, color) in enumerate(biomes):
        body += [f'<g transform="translate({i*128},0)"><polygon points="64,0 128,32 64,64 0,32" fill="{color}"/>']
        if kind == 'grass':
            o = 10 if i % 2 == 0 else 22
            body += [f'<path d="M{o},34l8,-4M{o+28},42l7,-3M{o+55},25l6,-3M{o+82},38l8,-4" stroke="#708663" stroke-width="2" opacity=".45"/>']
        elif kind == 'forest':
            points = [(30,34),(52,22),(76,28),(94,39)] if i % 2 == 0 else [(22,29),(48,38),(70,20),(102,31)]
            body += [f'<ellipse cx="{x}" cy="{y}" rx="8" ry="5" fill="#526b49" opacity=".52"/>' for x,y in points]
        elif kind == 'rock':
            pts = '25,36 37,27 50,31 44,42' if i % 2 == 0 else '74,22 88,17 99,26 89,34'
            body += [f'<polygon points="{pts}" fill="#6b6d6d" opacity=".65"/><path d="M44,22l16,8M69,38l17,-7" stroke="#929492" stroke-width="2" opacity=".45"/>']
        else:
            body += ['<path d="M16,32C32,25 47,39 63,32S95,25 112,32" fill="none" stroke="#78a1bb" stroke-width="2" opacity=".7"/>']
            if i % 2: body += ['<path d="M30,42C46,36 61,48 79,41" fill="none" stroke="#88aec4" stroke-width="1.5" opacity=".65"/>']
        body += ['</g>']
    return _root('terrain', body)


def roads() -> str:
    body: list[str] = []
    endpoints = {1:(96,16), 2:(96,48), 4:(32,48), 8:(32,16)}
    classes = [('local',18,0),('collector',23,1.8),('arterial',28,2.2)]
    for row,(name,width,mark) in enumerate(classes):
        for mask in range(16):
            body += [f'<g transform="translate({mask*128},{row*64})"><polygon points="64,0 128,32 64,64 0,32" fill="#b9b1a5"/><polygon points="64,3 122,32 64,61 6,32" fill="#c7c0b5" opacity=".55"/>']
            for bit,(ex,ey) in endpoints.items():
                if mask & bit: body += [f'<path d="M64,32L{ex},{ey}" stroke="#3f454a" stroke-width="{width}" stroke-linecap="butt"/>']
            body += [f'<ellipse cx="64" cy="32" rx="{width/2}" ry="{width/2.35}" fill="#3f454a"/>']
            if mark:
                for bit,(ex,ey) in endpoints.items():
                    if mask & bit: body += [f'<path d="M64,32L{ex},{ey}" stroke="#e3e0d5" stroke-width="{mark}" stroke-dasharray="5 5" opacity=".8"/>']
            if name == 'arterial':
                for bit,(ex,ey) in endpoints.items():
                    if mask & bit: body += [f'<path d="M64,32L{ex},{ey}" stroke="#d9be69" stroke-width="1.2" opacity=".9"/>']
            body += ['</g>']
    return _root('roads', body)


BUILDINGS = [
 ('res_low_detached_01','residential','low'),('res_low_detached_02','residential','low'),('res_low_detached_03','residential','low'),
 ('res_mid_rowhouse_01','residential','medium'),('res_mid_walkup_01','residential','medium'),('res_mid_courtyard_01','residential','medium'),
 ('res_high_slab_01','residential','high'),('res_high_podium_01','residential','high'),('res_high_tower_01','residential','high'),
 ('com_low_corner_01','commercial','low'),('com_low_strip_01','commercial','low'),('com_low_office_01','commercial','low'),
 ('com_mid_block_01','commercial','medium'),('com_mid_office_01','commercial','medium'),('com_mid_hotel_01','commercial','medium'),
 ('com_high_office_01','commercial','high'),('com_high_hotel_01','commercial','high'),('com_high_corporate_01','commercial','high'),
 ('ind_low_workshop_01','industrial','low'),('ind_low_repair_01','industrial','low'),('ind_low_warehouse_01','industrial','low'),
 ('ind_mid_distribution_01','industrial','medium'),('ind_mid_logistics_01','industrial','medium'),('ind_mid_factory_01','industrial','medium'),
 ('ind_high_plant_01','industrial','high'),('ind_high_processing_01','industrial','high'),('ind_high_manufacturing_01','industrial','high')]


def buildings() -> str:
    body: list[str] = []
    palette = {'residential':('#d7d1c5','#b9afa0','#ece8df','#465763'),'commercial':('#b8c4c9','#8c9ba1','#d9e2e5','#587786'),'industrial':('#b8b6ad','#8e8d86','#d1cec2','#545b5e')}
    heights = {'low':36,'medium':64,'high':118}
    for i,(_,zone,intensity) in enumerate(BUILDINGS):
        left,right,roof,win = palette[zone]; h = heights[intensity]; top = 146-h; half = 36 if intensity == 'low' else 41 if intensity == 'medium' else 38
        if i % 3 == 1: roof = '#c8b8a4' if zone == 'residential' else '#c6d0d3' if zone == 'commercial' else '#c4b184'
        if i % 3 == 2: right = '#a89a8b' if zone == 'residential' else '#7f929c' if zone == 'commercial' else '#7f8585'
        body += [f'<g transform="translate({i*128},0)"><ellipse cx="68" cy="154" rx="48" ry="16" fill="#263036" opacity=".18"/>',
                 f'<polygon points="64,{top} {64+half},{top+18} 64,{top+36} {64-half},{top+18}" fill="{roof}"/>',
                 f'<polygon points="{64-half},{top+18} 64,{top+36} 64,146 {64-half},128" fill="{left}"/>',
                 f'<polygon points="64,{top+36} {64+half},{top+18} {64+half},128 64,146" fill="{right}"/>']
        for floor in range(1,max(1,h//18)):
            yy = 146-floor*16
            body += [f'<path d="M{64-half+8},{yy-10}L60,{yy-2}" stroke="{win}" stroke-width="4" opacity=".72"/><path d="M68,{yy-2}L{64+half-8},{yy-10}" stroke="{win}" stroke-width="4" opacity=".72"/>']
        if zone == 'residential' and intensity == 'low': body += [f'<path d="M42,{top+17}L64,{top+4}L86,{top+17}" fill="none" stroke="#8d7866" stroke-width="5"/><rect x="76" y="112" width="8" height="12" fill="#7b6353"/>']
        elif zone == 'commercial': body += [f'<rect x="58" y="{top+8}" width="12" height="5" rx="1" fill="#69777d"/>']
        else: body += [f'<rect x="53" y="{top+8}" width="22" height="7" rx="1" fill="#6e7474"/>']
        body += ['<polygon points="64,142 102,160 64,178 26,160" fill="#8fa07c" opacity=".28"/></g>']
    return _root('buildings', body)


def construction() -> str:
    body: list[str] = []
    stages = ['site','foundation','structure','facade']; levels = [('low',38),('medium',72),('high',122)]
    for li,(_,height) in enumerate(levels):
        for si,stage in enumerate(stages):
            x = (li*4+si)*128; top=140-height
            body += [f'<g transform="translate({x},0)"><polygon points="64,112 112,136 64,160 16,136" fill="#b4976f"/><path d="M20,136L64,158L108,136" fill="none" stroke="#d8c08f" stroke-width="3" stroke-dasharray="5 3"/>']
            if stage != 'site': body += ['<polygon points="64,118 94,133 64,148 34,133" fill="#9b9b94"/>']
            if stage in ('structure','facade'):
                for px in (42,64,86): body += [f'<line x1="{px}" y1="135" x2="{px}" y2="{top+20}" stroke="#6f7779" stroke-width="4"/>']
                body += [f'<path d="M38,{top+22}L64,{top+10}L90,{top+22}" fill="none" stroke="#6f7779" stroke-width="4"/>']
            if stage == 'facade': body += [f'<polygon points="38,{top+22} 64,{top+34} 64,135 38,123" fill="#c7c3b8" opacity=".72"/><polygon points="64,{top+34} 90,{top+22} 90,123 64,135" fill="#aeb5b3" opacity=".72"/><path d="M32,{top+18}V{top-10}H58" stroke="#d3a541" stroke-width="3" fill="none"/>']
            body += ['</g>']
    return _root('construction', body)


def civic() -> str:
    names = [('fire_station','#9d554b'),('police_station','#556f91'),('clinic','#5e877b'),('elementary_school','#9a8250'),('landfill','#777b6a'),('recycling_center','#5f8464')]
    body: list[str] = []
    for i,(name,color) in enumerate(names):
        body += [f'<g transform="translate({i*128},0)"><ellipse cx="66" cy="142" rx="46" ry="14" fill="#253038" opacity=".18"/><polygon points="64,54 106,75 64,96 22,75" fill="#d5d0c5"/><polygon points="22,75 64,96 64,142 22,121" fill="{color}"/><polygon points="64,96 106,75 106,121 64,142" fill="{color}" opacity=".82"/>']
        glyph = {'fire_station':'<rect x="70" y="102" width="27" height="24" fill="#4b5559"/>','police_station':'<rect x="72" y="100" width="24" height="16" fill="#8799aa"/>','clinic':'<path d="M84,99v26M72,112h24" stroke="#e6ece8" stroke-width="7"/>','elementary_school':'<rect x="72" y="101" width="24" height="18" fill="#51636b"/>','landfill':'<path d="M31,110q16,-20 33,0t33,0" fill="none" stroke="#53594d" stroke-width="8"/>','recycling_center':'<circle cx="84" cy="107" r="14" fill="none" stroke="#dce9dd" stroke-width="4"/>'}[name]
        body += [glyph, '</g>']
    return _root('civic', body)


def utilities() -> str:
    body = [
      '<g><ellipse cx="64" cy="142" rx="40" ry="12" fill="#243039" opacity=".18"/><polygon points="64,58 102,78 64,98 26,78" fill="#b9b8ae"/><polygon points="26,78 64,98 64,140 26,120" fill="#6e7778"/><polygon points="64,98 102,78 102,120 64,140" fill="#555f63"/><path d="M46,91l12,8-9,7 15,9" fill="none" stroke="#e1bd52" stroke-width="5"/></g>',
      '<g transform="translate(128,0)"><ellipse cx="64" cy="145" rx="34" ry="10" fill="#243039" opacity=".18"/><rect x="50" y="82" width="28" height="56" fill="#7692a0"/><ellipse cx="64" cy="82" rx="14" ry="6" fill="#91a8b2"/><path d="M49,104h30M49,121h30" stroke="#d9e1e4" stroke-width="2"/></g>',
      '<g transform="translate(256,0)"><polygon points="64,106 108,128 64,150 20,128" fill="#7b806e"/><path d="M29,127q18,-28 35,0t35,0" fill="none" stroke="#575d50" stroke-width="10"/><rect x="91" y="103" width="6" height="27" fill="#656966"/></g>'
    ]
    return _root('utilities', body)


def vegetation() -> str:
    body: list[str] = []
    kinds = ['young','young','mature','mature','large','large','large','shrub','shrub']
    for i,kind in enumerate(kinds):
        body += [f'<g transform="translate({i*96},0)">']
        if kind == 'young': body += ['<ellipse cx="48" cy="122" rx="18" ry="6" fill="#26312b" opacity=".16"/><rect x="46" y="78" width="4" height="46" fill="#6b5946"/><ellipse cx="48" cy="70" rx="18" ry="25" fill="#66835c"/><ellipse cx="40" cy="62" rx="10" ry="14" fill="#7c986f"/>']
        elif kind == 'mature': body += ['<ellipse cx="48" cy="128" rx="22" ry="7" fill="#26312b" opacity=".16"/><rect x="44" y="72" width="8" height="56" fill="#675443"/><ellipse cx="48" cy="58" rx="29" ry="34" fill="#5e7c55"/><ellipse cx="35" cy="47" rx="17" ry="21" fill="#76946a"/>']
        elif kind == 'large': body += ['<ellipse cx="48" cy="132" rx="26" ry="8" fill="#26312b" opacity=".16"/><rect x="43" y="67" width="10" height="65" fill="#654f3f"/><ellipse cx="48" cy="47" rx="36" ry="41" fill="#55764d"/><ellipse cx="31" cy="42" rx="20" ry="25" fill="#6e8b61"/>']
        else: body += ['<ellipse cx="48" cy="128" rx="27" ry="9" fill="#26312b" opacity=".12"/><ellipse cx="48" cy="115" rx="28" ry="15" fill="#67875e"/><ellipse cx="38" cy="110" rx="12" ry="10" fill="#7a9970"/>']
        body += ['</g>']
    return _root('vegetation', body)


def vehicles() -> str:
    families = [('sedan','#d8d8d5'),('suv','#8b9a87'),('delivery_van','#d2c8b8'),('box_truck','#b9b6ad'),('freight_truck','#9eaaad'),('bus','#6f8fb2'),('brt','#5aa997'),('tram','#bb8c62'),('fire_engine','#a44e45'),('police','#4d6788'),('ambulance','#d6ddd9'),('garbage_truck','#6d8571')]
    body: list[str] = []
    for fi,(family,color) in enumerate(families):
        for orientation in range(4):
            x=(fi*4+orientation)*80
            if orientation == 0: points,glass='18,40 46,25 63,33 35,48','32,35 46,28 54,32 40,39'
            elif orientation == 1: points,glass='24,30 49,42 58,37 33,25','34,29 47,35 52,32 39,26'
            elif orientation == 2: points,glass='62,40 34,25 17,33 45,48','48,35 34,28 26,32 40,39'
            else: points,glass='56,30 31,42 22,37 47,25','46,29 33,35 28,32 41,26'
            body += [f'<g transform="translate({x},0)"><ellipse cx="40" cy="43" rx="22" ry="8" fill="#20272b" opacity=".18"/><polygon points="{points}" fill="{color}" stroke="#313a3f" stroke-width="1.5"/><polygon points="{glass}" fill="#6f8994" opacity=".9"/>']
            if family in ('bus','brt','tram','box_truck','freight_truck','garbage_truck'): body += ['<rect x="27" y="31" width="22" height="7" rx="2" fill="#c7d0d2" opacity=".5"/>']
            if family == 'fire_engine': body += ['<rect x="38" y="21" width="7" height="5" fill="#f0d7a0"/>']
            elif family == 'police': body += ['<rect x="37" y="23" width="8" height="4" fill="#9ec8df"/>']
            elif family == 'ambulance': body += ['<path d="M35,33h10M40,28v10" stroke="#b04a45" stroke-width="2.5"/>']
            body += ['</g>']
    return _root('vehicles', body)


B1_LEGACY_CONDITIONS = ('new', 'aging', 'neglected', 'abandoned')
B1_MIXED_CONDITIONS = ('new', 'maintained', 'aging', 'neglected', 'abandoned')
B1_MIXED_FAMILIES = (
    ('mix_mainstreet_corner_01', 'medium'),
    ('mix_mainstreet_row_01', 'medium'),
    ('mix_mainstreet_courtyard_01', 'medium'),
    ('mix_podium_slab_01', 'high'),
    ('mix_podium_tower_01', 'high'),
    ('mix_podium_courtyard_01', 'high'),
)


def _b1_frame_origin(slot: int) -> tuple[int, int]:
    return (slot % 16) * 128, (slot // 16) * 192


def _b1_condition_palette(zone: str, condition: str) -> tuple[str, str, str, str, str]:
    base = {
        'residential': ('#d7d1c5', '#b9afa0', '#ece8df', '#526774'),
        'commercial': ('#bdc9cd', '#8d9da3', '#dbe3e5', '#587786'),
        'industrial': ('#bbb9b0', '#8f8e87', '#d1cec2', '#545b5e'),
        'mixed': ('#c8c2b7', '#9ca6a4', '#d8d2c7', '#597481'),
    }[zone]
    left, right, roof, window = base
    ground = '#76906b'
    if condition == 'new':
        return left, right, '#eee9dd', '#658594', '#7f9e72'
    if condition == 'aging':
        return '#aaa79f', '#85877f', '#b9b5aa', '#53646b', '#718268'
    if condition == 'neglected':
        return '#8f8c83', '#6f726c', '#9a978e', '#414d52', '#65725d'
    if condition == 'abandoned':
        return '#77766f', '#5f625d', '#838078', '#273238', '#586b52'
    return left, right, roof, window, ground


def _b1_building_sprite(zone: str, intensity: str, condition: str, design: int, mixed: bool) -> str:
    left, right, roof, window, ground = _b1_condition_palette('mixed' if mixed else zone, condition)
    height = {'low': 38, 'medium': 72, 'high': 124}[intensity]
    if mixed and intensity == 'medium': height = 84 + design * 3
    if mixed and intensity == 'high': height = 126 + design * 5
    top = max(12, 146 - height)
    half = 35 if intensity == 'low' else 42 if intensity == 'medium' else 39
    if design % 3 == 1: half -= 4
    if design % 3 == 2: half += 3
    parts = [
        '<ellipse cx="68" cy="156" rx="49" ry="15" fill="#263036" opacity=".20"/>',
        f'<polygon points="64,{top} {64+half},{top+18} 64,{top+36} {64-half},{top+18}" fill="{roof}"/>',
        f'<polygon points="{64-half},{top+18} 64,{top+36} 64,146 {64-half},128" fill="{left}"/>',
        f'<polygon points="64,{top+36} {64+half},{top+18} {64+half},128 64,146" fill="{right}"/>',
    ]
    floors = max(1, height // 16)
    for floor in range(1, floors):
        yy = 146 - floor * 14
        if yy <= top + 22: break
        opacity = '.42' if condition == 'abandoned' else '.72'
        parts += [
            f'<path d="M{64-half+8},{yy-8}L59,{yy-1}" stroke="{window}" stroke-width="4" opacity="{opacity}"/>',
            f'<path d="M69,{yy-1}L{64+half-8},{yy-8}" stroke="{window}" stroke-width="4" opacity="{opacity}"/>',
        ]
    if mixed:
        storefront = '#40545c' if condition != 'abandoned' else '#30383a'
        awning = '#8e5e4c' if design % 2 == 0 else '#5d7387'
        parts += [
            f'<polygon points="{64-half+2},121 64,139 64,146 {64-half+2},128" fill="{storefront}" opacity=".92"/>',
            f'<polygon points="64,139 {64+half-2},121 {64+half-2},128 64,146" fill="{storefront}" opacity=".82"/>',
            f'<path d="M{64-half+5},121L60,136M68,136L{64+half-5},121" stroke="{awning}" stroke-width="5"/>',
        ]
        if intensity == 'high':
            parts += [f'<polygon points="38,{top+35} 64,{top+47} 90,{top+35} 90,{top+53} 64,{top+65} 38,{top+53}" fill="#697d83" opacity=".55"/>']
    elif zone == 'residential' and intensity == 'low':
        parts += [f'<path d="M42,{top+17}L64,{top+4}L86,{top+17}" fill="none" stroke="#806e60" stroke-width="5"/>']
    elif zone == 'industrial':
        parts += [f'<rect x="53" y="{top+7}" width="22" height="7" rx="1" fill="#666d6d"/>']
    else:
        parts += [f'<rect x="57" y="{top+7}" width="14" height="5" rx="1" fill="#68777c"/>']

    if condition == 'new':
        parts += ['<ellipse cx="31" cy="143" rx="7" ry="10" fill="#66865d"/><ellipse cx="96" cy="147" rx="6" ry="9" fill="#719065"/>']
    elif condition == 'aging':
        parts += [f'<path d="M{64-half+8},{top+42}l15,8m36,21l13,-6" stroke="#77766f" stroke-width="2" opacity=".55"/>']
    elif condition == 'neglected':
        parts += [f'<path d="M{64-half+7},{top+39}l17,10m-7,18l20,8M77,{top+54}l14,-8" stroke="#625f59" stroke-width="2.5" opacity=".75"/>', '<path d="M24,153q8,-16 13,0m47,4q8,-18 14,0" stroke="#536c4d" stroke-width="4" fill="none"/>']
    elif condition == 'abandoned':
        parts += ['<path d="M36,118l18,9m-17,0l18,-9M75,123l18,9m-17,0l18,-9" stroke="#5d493a" stroke-width="4"/><path d="M19,157q11,-24 17,0m46,3q13,-28 19,0m-62,-1q9,-17 14,0" stroke="#496345" stroke-width="5" fill="none"/>']

    parts += [f'<polygon points="64,144 105,164 64,184 23,164" fill="{ground}" opacity=".24"/>']
    return ''.join(parts)


def urban_depth_buildings() -> str:
    body: list[str] = []
    slot = 0
    for index, (_, zone, intensity) in enumerate(BUILDINGS):
        for condition in B1_LEGACY_CONDITIONS:
            x, y = _b1_frame_origin(slot)
            body += [f'<g transform="translate({x},{y})">', _b1_building_sprite(zone, intensity, condition, index % 3, False), '</g>']
            slot += 1
    for index, (_, intensity) in enumerate(B1_MIXED_FAMILIES):
        for condition in B1_MIXED_CONDITIONS:
            x, y = _b1_frame_origin(slot)
            body += [f'<g transform="translate({x},{y})">', _b1_building_sprite('mixed', intensity, condition, index % 3, True), '</g>']
            slot += 1
    if slot != 138:
        raise AssertionError(f'urban depth sheet expected 138 frames, got {slot}')
    return _root('urban_depth_buildings', body)


def build_svg_sheet(name: str) -> str:
    builders = {
        'terrain': terrain, 'roads': roads, 'buildings': buildings, 'construction': construction,
        'civic': civic, 'utilities': utilities, 'vegetation': vegetation, 'vehicles': vehicles,
        'urban_depth_buildings': urban_depth_buildings,
    }
    if name not in builders: raise KeyError(name)
    return builders[name]()
