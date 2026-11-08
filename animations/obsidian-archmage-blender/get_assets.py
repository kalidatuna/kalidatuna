import json, os, sys, urllib.request
out = sys.argv[1]
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "archmage-render/1.0"})) as r: return r.read()
def save(u, p):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    if not os.path.exists(p): open(p, 'wb').write(get(u))
def files(a): return json.loads(get(f'https://api.polyhaven.com/files/{a}'))
# HDRI
for h in ['rogland_clear_night']:
    f = files(h); save(f['hdri']['2k']['hdr']['url'], f'{out}/{h}.hdr')
# textures
for t in ['monastery_stone_floor', 'quatrefoil_jacquard_fabric', 'castle_wall_slates', 'rock_boulder_dry']:
    try: f = files(t)
    except Exception as e: print('missing', t, e); continue
    for m, key in [('diff', 'Diffuse'), ('nor', 'nor_gl'), ('rough', 'Rough'), ('disp', 'Displacement'), ('arm', 'arm')]:
        if key in f:
            fmt = 'jpg' if 'jpg' in f[key]['2k'] else 'png'
            save(f[key]['2k'][fmt]['url'], f'{out}/{t}/{m}.{fmt}')
# models
for mdl in ['moon_rock_01', 'moon_rock_02', 'moon_rock_03', 'namaqualand_boulder_02', 'rock_09']:
    f = files(mdl)['gltf']['1k']['gltf']
    save(f['url'], f'{out}/{mdl}/{mdl}.gltf')
    for p, v in f.get('include', {}).items(): save(v['url'], f'{out}/{mdl}/{p}')
print('done')
