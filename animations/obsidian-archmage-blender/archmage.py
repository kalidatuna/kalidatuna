"""The Obsidian Archmage -- Blender/Cycles build + render script.

  blender -b -P archmage.py -- build  <assets_dir> <out.blend>
  blender -b <out.blend> -P archmage.py -- render <start> <end> <samples> <out_prefix>
"""
import bpy, bmesh, math, random, sys, os
from mathutils import Vector, Matrix, Euler

FPS = 24
FRAMES = 240
BLAST = 7.6

def clamp01(x): return max(0.0, min(1.0, x))
def ss(a, b, t):
    x = clamp01((t - a) / (b - a)); return x * x * (3 - 2 * x)
def lerp(a, b, k): return a + (b - a) * k
def ease_out(x): x = clamp01(x); return 1 - (1 - x) ** 3
def tof(f): return (f - 1) / FPS

# ------------------------------------------------------------------ animation curves (shared by build + handlers)
def hover(t):
    return 0.3 + ss(2.0, 4.0, t) * 0.2 + math.sin(t * 1.6) * 0.015 * ss(2, 4, t)

POSES = {'idle': (-0.06, 0.10, -0.15), 'summon': (-0.30, 1.75, -0.40), 'cast': (-1.25, -0.40, -0.55),
         'thrust': (-1.50, -0.20, -0.08), 'after': (-0.80, -0.08, -0.55)}
SEQ = [(0, 'idle'), (1.3, 'idle'), (2.4, 'summon'), (3.6, 'summon'), (4.6, 'cast'), (7.4, 'cast'),
       (7.62, 'thrust'), (8.6, 'thrust'), (9.9, 'after')]
def arm_pose(t):
    i = 0
    while i < len(SEQ) - 2 and t > SEQ[i + 1][0]: i += 1
    (ta, pa), (tb, pb) = SEQ[i], SEQ[i + 1]
    k = ss(ta, tb, t)
    return [lerp(a, b, k) for a, b in zip(POSES[pa], POSES[pb])]

def orb_radius(t):
    g = ss(3.9, 7.3, t)
    r = g * 0.16 * (1 + 0.07 * math.sin(t * 17))
    if t > BLAST: r *= max(0.0, 1 - (t - BLAST) * 6)
    return r

# ------------------------------------------------------------------ helpers
def new_obj(name, me=None, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), coll=None):
    o = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(o)
    o.parent = parent; o.location = loc; o.rotation_euler = rot; o.scale = scale
    return o

def mesh_from_bm(name, bm, smooth=True):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    if smooth: me.shade_smooth()
    return me

def lathe(name, prof, segs=48, cap_top=False, cap_bot=False, smooth=True):
    """prof: list of (r, z). Builds a surface of revolution with UVs (u around, v along profile)."""
    bm = bmesh.new(); uv = bm.loops.layers.uv.new()
    rings = []
    for (r, z) in prof:
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / segs), r * math.sin(2 * math.pi * i / segs), z)) for i in range(segs)])
    L = [0.0]
    for i in range(1, len(prof)):
        L.append(L[-1] + math.dist(prof[i], prof[i - 1]))
    for j in range(len(rings) - 1):
        for i in range(segs):
            i2 = (i + 1) % segs
            f = bm.faces.new((rings[j][i], rings[j][i2], rings[j + 1][i2], rings[j + 1][i]))
            for lp, (uu, vv) in zip(f.loops, [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]):
                lp[uv].uv = (uu / segs, L[vv] / L[-1])
    if cap_bot: bm.faces.new(list(reversed(rings[0])))
    if cap_top: bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bm(name, bm, smooth)

def prim(name, kind, smooth=True, **kw):
    bm = bmesh.new()
    if kind == 'cube': bmesh.ops.create_cube(bm, size=1.0)
    elif kind == 'cone': bmesh.ops.create_cone(bm, cap_ends=kw.get('cap', True), segments=kw.get('segs', 16), radius1=kw['r1'], radius2=kw['r2'], depth=kw['depth'])
    elif kind == 'uvsphere': bmesh.ops.create_uvsphere(bm, u_segments=kw.get('u', 32), v_segments=kw.get('v', 16), radius=kw.get('r', 1.0))
    elif kind == 'ico': bmesh.ops.create_icosphere(bm, subdivisions=kw.get('sub', 2), radius=kw.get('r', 1.0))
    elif kind == 'grid': bmesh.ops.create_grid(bm, x_segments=kw['xs'], y_segments=kw['ys'], size=0.5)
    elif kind == 'circle': bmesh.ops.create_circle(bm, cap_ends=True, segments=kw.get('segs', 64), radius=kw.get('r', 1.0))
    elif kind == 'torus':
        R, rr, M, N = kw['R'], kw['rr'], kw.get('M', 64), kw.get('N', 12)
        vs = [[bm.verts.new(((R + rr * math.cos(b)) * math.cos(a), (R + rr * math.cos(b)) * math.sin(a), rr * math.sin(b)))
               for b in [2 * math.pi * j / N for j in range(N)]] for a in [2 * math.pi * i / M for i in range(M)]]
        for i in range(M):
            for j in range(N):
                bm.faces.new((vs[i][j], vs[(i + 1) % M][j], vs[(i + 1) % M][(j + 1) % N], vs[i][(j + 1) % N]))
    elif kind == 'octa':
        v = [bm.verts.new(p) for p in [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]]
        for a, b in [(0, 2), (2, 1), (1, 3), (3, 0)]:
            bm.faces.new((v[a], v[b], v[4])); bm.faces.new((v[b], v[a], v[5]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bm(name, bm, smooth)

def add_mods(o, bevel=None, subsurf=0, solidify=None):
    if bevel:
        m = o.modifiers.new('Bevel', 'BEVEL'); m.width = bevel; m.segments = 2; m.limit_method = 'ANGLE'; m.harden_normals = False
    if subsurf:
        m = o.modifiers.new('Subsurf', 'SUBSURF'); m.levels = subsurf; m.render_levels = subsurf
    if solidify:
        m = o.modifiers.new('Solidify', 'SOLIDIFY'); m.thickness = solidify; m.offset = 0

def setmat(o, mat): o.data.materials.clear(); o.data.materials.append(mat); return o

def kf(owner, path, frame, value=None, index=-1):
    if value is not None:
        if index >= 0: getattr(owner, path)[index] = value
        else: setattr(owner, path, value)
    owner.keyframe_insert(data_path=path, frame=frame, index=index)

def kf_socket(sock, frame, value):
    sock.default_value = value; sock.keyframe_insert('default_value', frame=frame)

# ------------------------------------------------------------------ materials
class N:
    """tiny node-building helper"""
    def __init__(self, mat):
        mat.use_nodes = True; self.nt = mat.node_tree; self.nt.nodes.clear(); self.x = 0
    def n(self, typ, **props):
        node = self.nt.nodes.new(typ)
        for k, v in props.items():
            if k.startswith('in_'): node.inputs[k[3:].replace('_', ' ')].default_value = v
            else: setattr(node, k, v)
        return node
    def l(self, a, b): self.nt.links.new(a, b)

def principled(name, base=(0.8, 0.8, 0.8), metal=0.0, rough=0.5, rough_var=0.0, scale_var=40.0, **extra):
    mat = bpy.data.materials.new(name); b = N(mat)
    out = b.n('ShaderNodeOutputMaterial'); p = b.n('ShaderNodeBsdfPrincipled')
    p.inputs['Base Color'].default_value = (*base, 1); p.inputs['Metallic'].default_value = metal; p.inputs['Roughness'].default_value = rough
    for k, v in extra.items():
        p.inputs[k.replace('_', ' ')].default_value = v
    if rough_var:
        nz = b.n('ShaderNodeTexNoise', in_Scale=scale_var, in_Detail=8.0)
        cr = b.n('ShaderNodeMapRange', in_To_Min=rough - rough_var, in_To_Max=rough + rough_var)
        b.l(nz.outputs['Fac'], cr.inputs['Value']); b.l(cr.outputs['Result'], p.inputs['Roughness'])
        bump = b.n('ShaderNodeBump', in_Strength=0.08, in_Distance=0.002)
        nz2 = b.n('ShaderNodeTexNoise', in_Scale=scale_var * 6, in_Detail=4.0)
        b.l(nz2.outputs['Fac'], bump.inputs['Height']); b.l(bump.outputs['Normal'], p.inputs['Normal'])
    b.l(p.outputs['BSDF'], out.inputs['Surface'])
    return mat

def emissive(name, color, strength=10.0, image=None, alpha_from_image=False):
    mat = bpy.data.materials.new(name); b = N(mat)
    out = b.n('ShaderNodeOutputMaterial'); em = b.n('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1); em.inputs['Strength'].default_value = strength
    if image:
        tx = b.n('ShaderNodeTexImage'); tx.image = image
        tr = b.n('ShaderNodeBsdfTransparent'); add = b.n('ShaderNodeAddShader')
        mc = b.n('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY'); mc.inputs['Factor'].default_value = 1.0; mc.inputs['B'].default_value = (*color, 1)
        b.l(tx.outputs['Color'], mc.inputs['A']); b.l(mc.outputs['Result'], em.inputs['Color'])
        b.l(tr.outputs['BSDF'], add.inputs[0]); b.l(em.outputs['Emission'], add.inputs[1])
        b.l(add.outputs['Shader'], out.inputs['Surface'])
    else:
        b.l(em.outputs['Emission'], out.inputs['Surface'])
    mat.node_tree.nodes['Emission'].name = 'EMIT'
    return mat

def pbr_textured(name, folder, tint=None, scale=(1, 1, 1), coords='UV', box=False, normal_strength=1.0, metal=0.0, rough_mul=1.0, sheen=0.0, extra_mix=None):
    mat = bpy.data.materials.new(name); b = N(mat)
    out = b.n('ShaderNodeOutputMaterial'); p = b.n('ShaderNodeBsdfPrincipled')
    tc = b.n('ShaderNodeTexCoord'); mp = b.n('ShaderNodeMapping'); mp.inputs['Scale'].default_value = scale
    b.l(tc.outputs['Object' if box else coords], mp.inputs['Vector'])
    def img(fn, noncolor):
        path = os.path.join(folder, fn)
        if not os.path.exists(path): return None
        t = b.n('ShaderNodeTexImage'); t.image = bpy.data.images.load(path, check_existing=True)
        if noncolor: t.image.colorspace_settings.name = 'Non-Color'
        if box: t.projection = 'BOX'; t.projection_blend = 0.25
        b.l(mp.outputs['Vector'], t.inputs['Vector']); return t
    d = img('diff.jpg', False)
    if d:
        if tint:
            mx = b.n('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY'); mx.inputs['Factor'].default_value = 1.0
            mx.inputs['B'].default_value = (*tint, 1)
            b.l(d.outputs['Color'], mx.inputs['A']); b.l(mx.outputs['Result'], p.inputs['Base Color'])
        else:
            b.l(d.outputs['Color'], p.inputs['Base Color'])
    r = img('rough.jpg', True)
    if r:
        m = b.n('ShaderNodeMath', operation='MULTIPLY', in_Value=rough_mul) if False else b.n('ShaderNodeMath', operation='MULTIPLY')
        m.inputs[1].default_value = rough_mul
        b.l(r.outputs['Color'], m.inputs[0]); b.l(m.outputs['Value'], p.inputs['Roughness'])
    nr = img('nor.jpg', True)
    if nr:
        nm = b.n('ShaderNodeNormalMap', in_Strength=normal_strength)
        b.l(nr.outputs['Color'], nm.inputs['Color']); b.l(nm.outputs['Normal'], p.inputs['Normal'])
    p.inputs['Metallic'].default_value = metal
    p.inputs['Sheen Weight'].default_value = sheen
    p.inputs['Sheen Tint'].default_value = (1.0, 0.55, 0.6, 1)
    surf = p.outputs['BSDF']
    if extra_mix:  # (factor_socket_builder, shader_builder)
        fac = extra_mix[0](b); sh = extra_mix[1](b)
        mix = b.n('ShaderNodeMixShader'); b.l(fac, mix.inputs['Fac']); b.l(surf, mix.inputs[1]); b.l(sh, mix.inputs[2]); surf = mix.outputs['Shader']
    b.l(surf, out.inputs['Surface'])
    return mat

# ------------------------------------------------------------------ BUILD
def build(assets, out_path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, FRAMES
    sc.render.fps = FPS
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1280, 720, 100
    sc.render.engine = 'CYCLES'
    cy = sc.cycles
    cy.device = 'CPU'; cy.samples = 20; cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.05
    cy.use_denoising = True; cy.denoiser = 'OPENIMAGEDENOISE'
    cy.max_bounces = 4; cy.diffuse_bounces = 2; cy.glossy_bounces = 2; cy.transmission_bounces = 4; cy.volume_bounces = 0; cy.transparent_max_bounces = 8
    cy.caustics_reflective = False; cy.caustics_refractive = False; cy.blur_glossy = 1.0
    cy.volume_step_rate = 2.0; cy.volume_max_steps = 256
    try: cy.use_light_tree = True
    except Exception: pass
    sc.render.use_motion_blur = True; sc.render.motion_blur_shutter = 0.45
    sc.render.use_persistent_data = True
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    for look in ('AgX - Medium High Contrast', 'AgX - Punchy', 'Medium High Contrast'):
        try: sc.view_settings.look = look; break
        except Exception: pass
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGB'

    A = lambda *p: os.path.join(assets, *p)
    random.seed(1337)

    # ---- world: real night-sky HDRI
    w = bpy.data.worlds.new('Night'); sc.world = w; b = N(w)
    out = b.n('ShaderNodeOutputWorld'); bg = b.n('ShaderNodeBackground', in_Strength=0.3)
    env = b.n('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(A('rogland_clear_night.hdr'))
    tc = b.n('ShaderNodeTexCoord'); mp = b.n('ShaderNodeMapping'); mp.inputs['Rotation'].default_value = (0, 0, math.radians(200))
    b.l(tc.outputs['Generated'], mp.inputs['Vector']); b.l(mp.outputs['Vector'], env.inputs['Vector'])
    b.l(env.outputs['Color'], bg.inputs['Color']); b.l(bg.outputs['Background'], out.inputs['Surface'])
    w.node_tree.nodes['Background'].name = 'BG'

    # ---- materials
    stone_floor = pbr_textured('StoneFloor', A('monastery_stone_floor'), tint=(0.55, 0.52, 0.58), scale=(9, 9, 9), normal_strength=1.2)
    dais_mat = pbr_textured('DaisStone', A('monastery_stone_floor'), tint=(0.5, 0.47, 0.52), scale=(0.6, 0.6, 0.6), box=True, normal_strength=1.4)
    pillar_mat = pbr_textured('PillarStone', A('castle_wall_slates'), tint=(0.5, 0.48, 0.55), scale=(0.45, 0.45, 0.45), box=True, normal_strength=1.5)
    rock_mat = pbr_textured('Rock', A('rock_boulder_dry'), tint=(0.42, 0.4, 0.46), scale=(0.9, 0.9, 0.9), box=True, normal_strength=1.5)

    def gold_trim_factor(bld):
        tc = bld.n('ShaderNodeTexCoord'); sep = bld.n('ShaderNodeSeparateXYZ'); bld.l(tc.outputs['UV'], sep.inputs['Vector'])
        hem = bld.n('ShaderNodeMath', operation='LESS_THAN'); hem.inputs[1].default_value = 0.035; bld.l(sep.outputs['Y'], hem.inputs[0])
        d = bld.n('ShaderNodeMath', operation='SUBTRACT'); d.inputs[1].default_value = 0.75; bld.l(sep.outputs['X'], d.inputs[0])
        ab = bld.n('ShaderNodeMath', operation='ABSOLUTE'); bld.l(d.outputs['Value'], ab.inputs[0])
        strip = bld.n('ShaderNodeMath', operation='LESS_THAN'); strip.inputs[1].default_value = 0.008; bld.l(ab.outputs['Value'], strip.inputs[0])
        mx = bld.n('ShaderNodeMath', operation='MAXIMUM'); bld.l(hem.outputs['Value'], mx.inputs[0]); bld.l(strip.outputs['Value'], mx.inputs[1])
        return mx.outputs['Value']
    def gold_shader(bld):
        p = bld.n('ShaderNodeBsdfPrincipled'); p.inputs['Base Color'].default_value = (1.0, 0.72, 0.32, 1)
        p.inputs['Metallic'].default_value = 1.0; p.inputs['Roughness'].default_value = 0.3
        return p.outputs['BSDF']
    robe_mat = pbr_textured('RobeJacquard', A('quatrefoil_jacquard_fabric'), tint=(0.42, 0.025, 0.05), scale=(7, 3.5, 1), normal_strength=0.8, sheen=0.6,
                            extra_mix=(gold_trim_factor, gold_shader))
    sleeve_mat = pbr_textured('SleeveJacquard', A('quatrefoil_jacquard_fabric'), tint=(0.42, 0.025, 0.05), scale=(2, 1.2, 1), normal_strength=0.8, sheen=0.6)

    gold = principled('Gold', (1.0, 0.71, 0.29), metal=1.0, rough=0.24, rough_var=0.1)
    iron = principled('BlackIron', (0.11, 0.105, 0.12), metal=1.0, rough=0.32, rough_var=0.12)
    leather = principled('Leather', (0.025, 0.018, 0.016), rough=0.55, rough_var=0.15, scale_var=80)
    obsidian = principled('Obsidian', (0.006, 0.005, 0.009), rough=0.05, Coat_Weight=1.0, Coat_Roughness=0.02, Specular_IOR_Level=0.7)
    eye_mat = emissive('EyeGlow', (0.72, 0.42, 1.0), 0.5)
    gem_mat = emissive('GemGlow', (0.72, 0.42, 1.0), 2.0)

    cape_mat = bpy.data.materials.new('CapeVelvet'); b = N(cape_mat)
    out = b.n('ShaderNodeOutputMaterial'); geo = b.n('ShaderNodeNewGeometry')
    outer = b.n('ShaderNodeBsdfPrincipled'); outer.inputs['Base Color'].default_value = (0.018, 0.01, 0.028, 1); outer.inputs['Roughness'].default_value = 0.85
    outer.inputs['Sheen Weight'].default_value = 1.0; outer.inputs['Sheen Tint'].default_value = (0.55, 0.35, 0.85, 1); outer.inputs['Sheen Roughness'].default_value = 0.4
    inner = b.n('ShaderNodeBsdfPrincipled'); inner.inputs['Base Color'].default_value = (0.32, 0.015, 0.035, 1); inner.inputs['Roughness'].default_value = 0.32
    inner.inputs['Sheen Weight'].default_value = 0.5
    mix = b.n('ShaderNodeMixShader'); b.l(geo.outputs['Backfacing'], mix.inputs['Fac']); b.l(inner.outputs['BSDF'], mix.inputs[1]); b.l(outer.outputs['BSDF'], mix.inputs[2])
    b.l(mix.outputs['Shader'], out.inputs['Surface'])

    # ---- environment geometry
    fl = new_obj('Floor', prim('Floor', 'grid', xs=2, ys=2)); fl.scale = (60, 60, 1); setmat(fl, stone_floor)
    fl.data.uv_layers.new(); [setattr(l, 'uv', (v.co.x + 0.5, v.co.y + 0.5)) for l, v in []]
    # proper UVs for floor
    me = fl.data; uvl = me.uv_layers[0]
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co; uvl.data[li].uv = (co.x + 0.5, co.y + 0.5)
    fl.data.materials[0] = stone_floor

    dais = new_obj('Dais', lathe('Dais', [(0.0, 0.0), (2.75, 0.0), (2.75, 0.18), (2.62, 0.3), (0.0, 0.3)], 96, smooth=False))
    add_mods(dais, bevel=0.02); setmat(dais, dais_mat)
    step = new_obj('DaisStep', lathe('DaisStep', [(0.0, 0.0), (3.25, 0.0), (3.25, 0.12), (3.15, 0.15), (0.0, 0.15)], 96, smooth=False))
    add_mods(step, bevel=0.015); setmat(step, dais_mat)

    for i in range(8):
        a = math.pi * 0.12 + i / 7 * math.pi * 0.76  # back arc (+Y is behind the mage)
        h = random.uniform(2.6, 6.5); r = random.uniform(0.38, 0.48)
        x, y = math.cos(a) * 8.0, math.sin(a) * 7.0 + 1.0
        col = new_obj(f'Pillar{i}', prim(f'Pillar{i}', 'cone', r1=r, r2=r * 0.92, depth=h, segs=20, smooth=False), loc=(x, y, h / 2), rot=(random.uniform(-.04, .04), random.uniform(-.04, .04), 0))
        add_mods(col, bevel=0.03); setmat(col, pillar_mat)
        base = new_obj(f'PillarBase{i}', prim(f'PB{i}', 'cube'), loc=(x, y, 0.2), scale=(r * 2.6, r * 2.6, 0.4)); add_mods(base, bevel=0.03); setmat(base, pillar_mat)
        if h > 4.5:
            cap = new_obj(f'PillarCap{i}', prim(f'PC{i}', 'cube'), loc=(x, y, h + 0.15), rot=(0, 0, random.random()), scale=(r * 2.8, r * 2.8, 0.32)); add_mods(cap, bevel=0.03); setmat(cap, pillar_mat)

    # photoscanned rocks
    rock_srcs = []
    for name in ['moon_rock_01', 'moon_rock_02', 'moon_rock_03', 'rock_09', 'namaqualand_boulder_02']:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=A(name, name + '.gltf'))
        new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
        for o in new:
            o.location = (0, 0, -50); dim = max(o.dimensions); o.scale = [s / dim for s in o.scale]
            rock_srcs.append(o)
    bpy.context.view_layer.update()
    ground_rocks = []
    for i in range(12):
        src = random.choice(rock_srcs[:4]); o = src.copy(); sc.collection.objects.link(o)
        a = random.uniform(0, 2 * math.pi); rr = random.uniform(3.6, 7.5); s = random.uniform(0.25, 0.8)
        o.location = (math.cos(a) * rr, math.sin(a) * rr, s * 0.15); o.scale = [k * s for k in src.scale]; o.rotation_euler = (random.random() * 6, random.random() * 6, random.random() * 6)
        ground_rocks.append(o)
    big = rock_srcs[-1].copy(); sc.collection.objects.link(big); big.location = (-6.5, 9, 0.6); big.scale = [k * 5 for k in rock_srcs[-1].scale]

    floaters = []
    for i in range(16):
        src = random.choice(rock_srcs[:4]); o = src.copy(); sc.collection.objects.link(o)
        sz = random.uniform(0.12, 0.42)
        o.scale = [k * sz for k in src.scale]
        o['a'] = random.uniform(0, 2 * math.pi); o['rr'] = random.uniform(1.4, 3.6); o['sz'] = sz
        o['rise'] = random.uniform(0.6, 2.4); o['delay'] = random.uniform(0, 1.5); o['ph'] = random.uniform(0, 6)
        o['spin'] = (random.random(), random.random(), random.random())
        floaters.append(o)

    # braziers with real volumetric fire
    fire_mat = bpy.data.materials.new('Fire'); b = N(fire_mat)
    out = b.n('ShaderNodeOutputMaterial'); vol = b.n('ShaderNodeVolumePrincipled')
    tc = b.n('ShaderNodeTexCoord'); nz = b.n('ShaderNodeTexNoise', noise_dimensions='4D', in_Scale=3.2, in_Detail=6.0, in_Roughness=0.6)
    mp = b.n('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1, 1, 0.55)
    b.l(tc.outputs['Object'], mp.inputs['Vector']); b.l(mp.outputs['Vector'], nz.inputs['Vector'])
    grad = b.n('ShaderNodeTexGradient', gradient_type='SPHERICAL'); b.l(tc.outputs['Object'], grad.inputs['Vector'])
    sepz = b.n('ShaderNodeSeparateXYZ'); b.l(tc.outputs['Object'], sepz.inputs['Vector'])
    taper = b.n('ShaderNodeMapRange', in_From_Min=-1.0, in_From_Max=1.0, in_To_Min=1.0, in_To_Max=0.0); b.l(sepz.outputs['Z'], taper.inputs['Value'])
    m1 = b.n('ShaderNodeMath', operation='MULTIPLY'); b.l(nz.outputs['Fac'], m1.inputs[0]); b.l(grad.outputs['Fac'], m1.inputs[1])
    m2 = b.n('ShaderNodeMath', operation='MULTIPLY'); b.l(m1.outputs['Value'], m2.inputs[0]); b.l(taper.outputs['Result'], m2.inputs[1])
    cut = b.n('ShaderNodeMapRange', in_From_Min=0.12, in_From_Max=0.4, in_To_Min=0.0, in_To_Max=1.0); b.l(m2.outputs['Value'], cut.inputs['Value'])
    ramp = b.n('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].color = (0.6, 0.05, 0.0, 1); ramp.color_ramp.elements[1].color = (1.0, 0.75, 0.3, 1)
    b.l(cut.outputs['Result'], ramp.inputs['Fac'])
    dens = b.n('ShaderNodeMath', operation='MULTIPLY'); dens.inputs[1].default_value = 3.0; b.l(cut.outputs['Result'], dens.inputs[0])
    emis = b.n('ShaderNodeMath', operation='MULTIPLY'); emis.inputs[1].default_value = 45.0; b.l(cut.outputs['Result'], emis.inputs[0])
    vol.inputs['Color'].default_value = (0.05, 0.03, 0.02, 1)
    b.l(dens.outputs['Value'], vol.inputs['Density']); b.l(ramp.outputs['Color'], vol.inputs['Emission Color']); b.l(emis.outputs['Value'], vol.inputs['Emission Strength'])
    b.l(vol.outputs['Volume'], out.inputs['Volume'])
    for f in range(1, FRAMES + 1):
        kf_socket(nz.inputs['W'], f, f * 0.09)
    braziers = []
    for s in (-1, 1):
        x, y = s * 2.25, 1.3
        stand = new_obj(f'BrazierStand{s}', lathe('Stand', [(0.0, 0.3), (0.22, 0.3), (0.2, 0.36), (0.06, 0.42), (0.05, 1.0), (0.09, 1.04), (0.0, 1.04)], 24, cap_top=True), loc=(x, y, 0))
        setmat(stand, iron)
        bowl = new_obj(f'BrazierBowl{s}', lathe('Bowl', [(0.0, 1.0), (0.12, 1.02), (0.3, 1.12), (0.36, 1.25), (0.33, 1.25), (0.27, 1.14), (0.0, 1.12)], 32), loc=(x, y, 0))
        setmat(bowl, iron)
        coals = new_obj(f'Coals{s}', prim('Coals', 'ico', sub=2, r=1.0, smooth=False), loc=(x, y, 1.18), scale=(0.27, 0.27, 0.06)); setmat(coals, emissive('Coals', (1.0, 0.3, 0.05), 6.0))
        fire = new_obj(f'Fire{s}', prim('FireVol', 'cube', smooth=False), loc=(x, y, 1.55), scale=(0.3, 0.3, 0.5)); setmat(fire, fire_mat)
        ld = bpy.data.lights.new(f'FireLight{s}', 'POINT'); ld.color = (1.0, 0.5, 0.18); ld.shadow_soft_size = 0.25
        lo = new_obj(f'FireLight{s}', ld, loc=(x, y, 1.5))
        for f in range(1, FRAMES + 1):
            t = tof(f); kf(ld, 'energy', f, 260 * (1 + 0.18 * math.sin(t * 23 + s) + 0.12 * math.sin(t * 37 + 2 * s)))
        braziers.append(lo)

    # atmosphere: homogeneous fog (cheap in Cycles) for light shafts / glow
    fog_mat = bpy.data.materials.new('Fog'); b = N(fog_mat)
    out = b.n('ShaderNodeOutputMaterial'); vol = b.n('ShaderNodeVolumePrincipled', in_Density=0.007, in_Anisotropy=0.45)
    vol.inputs['Color'].default_value = (0.75, 0.78, 1.0, 1); b.l(vol.outputs['Volume'], out.inputs['Volume'])
    fog = new_obj('Fog', prim('FogBox', 'cube', smooth=False), loc=(0, 1, 3.5), scale=(26, 26, 7)); setmat(fog, fog_mat)
    fog.visible_shadow = False; fog.hide_render = True; fog.hide_viewport = True
    bpy.context.view_layer.use_pass_mist = True
    w.mist_settings.start = 3.5; w.mist_settings.depth = 26.0; w.mist_settings.falloff = 'QUADRATIC'

    # ---- lighting
    moon = bpy.data.lights.new('Moon', 'SUN'); moon.energy = 0.35; moon.color = (0.62, 0.74, 1.0); moon.angle = math.radians(1.0)
    new_obj('Moon', moon, rot=(math.radians(58), 0, math.radians(200)))
    def area(name, loc, target, power, color, size):
        ld = bpy.data.lights.new(name, 'AREA'); ld.energy = power; ld.color = color; ld.size = size; ld.shape = 'DISK'
        o = new_obj(name, ld, loc=loc)
        d = Vector(target) - Vector(loc); o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler(); return o
    area('RimLeft', (-2.2, 2.6, 3.4), (0, 0, 1.6), 260, (0.55, 0.8, 1.0), 1.2)
    area('RimRight', (2.4, 2.2, 3.0), (0, 0, 1.6), 200, (0.75, 0.55, 1.0), 1.2)
    area('Fill', (1.5, -6, 2.5), (0, 0, 1.5), 25, (1.0, 0.75, 0.6), 3.0)

    # ---- the Archmage
    root = new_obj('Mage', None)
    for f in range(1, FRAMES + 1):
        t = tof(f); root.location = (0, 0, hover(t))
        rx = (-0.05 * math.exp(-(t - BLAST) * 3) if t > BLAST else 0)
        root.rotation_euler = (-rx, 0, 0)
        root.keyframe_insert('location', frame=f); root.keyframe_insert('rotation_euler', frame=f)

    # robe (cloth)
    prof = [(0.72, 0.02), (0.64, 0.25), (0.52, 0.55), (0.40, 0.85), (0.32, 1.06)]
    fine = []
    for i in range(len(prof) - 1):
        for k in range(6):
            q = k / 6; fine.append((lerp(prof[i][0], prof[i + 1][0], q), lerp(prof[i][1], prof[i + 1][1], q)))
    fine.append(prof[-1])
    robe = new_obj('Robe', lathe('Robe', fine, 96), parent=root); setmat(robe, robe_mat)
    for v in robe.data.vertices:
        ang = math.atan2(v.co.y, v.co.x); depth = clamp01((1.06 - v.co.z) / 1.04)
        k = 1 + depth ** 1.3 * (0.075 * math.sin(14 * ang) + 0.03 * math.sin(23 * ang + 1.3))
        v.co.x *= k; v.co.y *= k
    vg = robe.vertex_groups.new(name='pin')
    for v in robe.data.vertices:
        w_ = clamp01((v.co.z - 0.55) / 0.4) ** 1.5
        if w_ > 0: vg.add([v.index], w_, 'REPLACE')
    cl = robe.modifiers.new('Cloth', 'CLOTH'); cs = cl.settings
    cs.quality = 7; cs.mass = 0.6; cs.air_damping = 1.5; cs.tension_stiffness = 25; cs.compression_stiffness = 25; cs.shear_stiffness = 8; cs.bending_stiffness = 0.6
    cs.vertex_group_mass = 'pin'; cs.pin_stiffness = 3.0
    cl.collision_settings.distance_min = 0.008; cl.collision_settings.use_self_collision = False
    cl.point_cache.frame_start = 1; cl.point_cache.frame_end = FRAMES
    add_mods(robe, subsurf=1, solidify=0.008)
    legs = new_obj('LegsCollider', lathe('Legs', [(0.0, 0.0), (0.28, 0.0), (0.27, 0.6), (0.29, 1.06), (0.0, 1.06)], 24), parent=root)
    legs.modifiers.new('Collision', 'COLLISION'); legs.collision.thickness_outer = 0.02; legs.hide_render = True
    for o in (dais, step):
        o.modifiers.new('Collision', 'COLLISION'); o.collision.thickness_outer = 0.01

    # torso armour
    torso = new_obj('Torso', lathe('Torso', [(0.27, 0.98), (0.33, 1.15), (0.37, 1.33), (0.375, 1.46), (0.31, 1.58), (0.14, 1.66), (0.0, 1.68)], 48), parent=root, scale=(1, 0.78, 1))
    add_mods(torso, subsurf=2); setmat(torso, iron)
    torso.modifiers.new('Collision', 'COLLISION'); torso.collision.thickness_outer = 0.015
    for z, r, rr in [(1.06, 0.3, 0.028), (1.33, 0.372, 0.01), (1.46, 0.378, 0.008)]:
        o = new_obj('Trim', prim('Trim', 'torus', R=r, rr=rr), parent=root, loc=(0, 0, z), scale=(1, 0.78, 1)); setmat(o, gold)
    # armoured faulds (overlapping waist plates) covering the robe join
    for i in range(14):
        a = 2 * math.pi * i / 14
        fp = new_obj('Fauld', lathe('Fauld', [(0.33, 1.08), (0.4, 0.92), (0.46, 0.74)], 8), parent=root,
                     rot=(0, 0, a), scale=(1, 0.8, 1))
        bm = bmesh.new(); bm.from_mesh(fp.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if abs(math.atan2(v.co.y, v.co.x)) > 0.3], context='VERTS'); bm.to_mesh(fp.data); bm.free()
        add_mods(fp, solidify=0.008, bevel=0.003); setmat(fp, iron if i % 2 else gold)
        fp.location = (0, 0, 0.002 * (i % 2))
    # chest plate ridge + gem
    for s in (-1, 1):
        o = new_obj('ChestPlate', prim('CP', 'cube'), parent=root, loc=(s * 0.12, -0.29, 1.4), rot=(0.25, 0, s * 0.5), scale=(0.16, 0.02, 0.2)); add_mods(o, bevel=0.006, subsurf=1); setmat(o, iron)
    gem = new_obj('ChestGem', prim('Gem', 'octa', smooth=False), parent=root, loc=(0, -0.305, 1.3), scale=(0.03, 0.02, 0.055)); setmat(gem, gem_mat)
    gemset = new_obj('GemSetting', prim('GS', 'torus', R=0.045, rr=0.008), parent=root, loc=(0, -0.3, 1.3), rot=(math.pi / 2, 0, 0), scale=(0.8, 1.3, 1)); setmat(gemset, gold)

    # pauldrons
    for s in (-1, 1):
        for k, (z, r) in enumerate([(1.55, 0.17), (1.47, 0.15)]):
            p = new_obj('Pauldron', prim('P', 'uvsphere', r=r, u=32, v=16), parent=root, loc=(s * (0.36 + k * 0.03), 0, z), rot=(0, -s * (0.35 + k * 0.25), 0), scale=(1.25, 1.0, 0.75))
            bm = bmesh.new(); bm.from_mesh(p.data)
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.02], context='VERTS'); bm.to_mesh(p.data); bm.free()
            add_mods(p, solidify=0.012, subsurf=1); setmat(p, gold if k == 0 else iron)
        for k in range(3):
            sp = new_obj('Spike', prim('Sp', 'cone', r1=0.022, r2=0.0, depth=0.16, segs=8), parent=root,
                         loc=(s * (0.33 + k * 0.08), 0.02 - k * 0.02, 1.66 - k * 0.04), rot=(0, -s * (0.45 + k * 0.3), 0))
            setmat(sp, iron)
    # high shard collar
    for i in range(7):
        a = math.pi / 2 + (i - 3) * 0.36; h = 0.34 - abs(i - 3) * 0.045
        c = new_obj('Collar', prim('Cl', 'cone', r1=0.035, r2=0.0, depth=h, segs=4, smooth=False), parent=root,
                    loc=(math.cos(a) * 0.16, math.sin(a) * 0.15, 1.68 + h / 2), rot=(-math.sin(a) * 0.32, math.cos(a) * 0.32, a))
        add_mods(c, bevel=0.003); setmat(c, iron)
    neck = new_obj('Neck', prim('Neck', 'cone', r1=0.065, r2=0.06, depth=0.18), parent=root, loc=(0, 0, 1.74)); setmat(neck, leather)

    # head: faceted obsidian helm, eye slits, gold crown
    head = new_obj('Head', None, parent=root, loc=(0, 0, 1.9))
    for f in range(1, FRAMES + 1):
        t = tof(f); head.rotation_euler = (lerp(-0.14, 0.05, ss(1.0, 2.4, t)) + (0.08 * math.exp(-(t - BLAST) * 3) if t > BLAST else 0), 0, math.sin(t * 0.7) * 0.05)
        head.keyframe_insert('rotation_euler', frame=f)
    helm = new_obj('Helm', prim('Helm', 'ico', sub=2, r=1.0, smooth=False), parent=head, scale=(0.105, 0.118, 0.135))
    add_mods(helm, bevel=0.012); setmat(helm, obsidian)
    for s in (-1, 1):
        e = new_obj('Eye', prim('Eye', 'cube', smooth=False), parent=head, loc=(s * 0.036, -0.108, 0.018), rot=(0, s * 0.32, s * 0.33), scale=(0.034, 0.012, 0.0065)); setmat(e, eye_mat)
        el = bpy.data.lights.new('EyeLight', 'POINT'); el.color = (0.7, 0.45, 1.0); el.shadow_soft_size = 0.01
        new_obj('EyeLight', el, parent=head, loc=(s * 0.036, -0.13, 0.018))
        for f in range(1, FRAMES + 1):
            t = tof(f); kf(el, 'energy', f, 0 if t < 0.6 else 0.4 * ss(0.6, 1.0, t))
    ridge = new_obj('Ridge', prim('Ridge', 'cube'), parent=head, loc=(0, -0.112, -0.035), rot=(0.25, 0, 0), scale=(0.006, 0.01, 0.09)); add_mods(ridge, bevel=0.002); setmat(ridge, gold)
    band = new_obj('CrownBand', prim('Band', 'torus', R=0.1, rr=0.008), parent=head, loc=(0, 0.0, 0.085), rot=(-0.12, 0, 0), scale=(1.02, 1.15, 1)); setmat(band, gold)
    for i in range(7):
        a = -math.pi / 2 + (i - 3) * 0.42; h = 0.16 - abs(i - 3) * 0.028
        c = new_obj('CrownSpike', prim('CS', 'cone', r1=0.011, r2=0.0, depth=h, segs=6, smooth=False), parent=head,
                    loc=(math.cos(a) * 0.102, math.sin(a) * 0.117, 0.085 + h / 2 - 0.01 * (1 if i != 3 else 0)), rot=(-math.sin(a) * 0.25, math.cos(a) * 0.25, 0))
        add_mods(c, bevel=0.002); setmat(c, gold)
    cg = new_obj('CrownGem', prim('CG', 'octa', smooth=False), parent=head, loc=(0, -0.122, 0.095), scale=(0.012, 0.008, 0.02)); setmat(cg, gem_mat)

    # arms
    arms = []
    for s in (-1, 1):
        sh = new_obj(f'Shoulder{s}', None, parent=root, loc=(s * 0.4, 0, 1.5)); sh.rotation_mode = 'YXZ'
        sleeve = new_obj('Sleeve', lathe('Sleeve', [(0.07, 0.02), (0.085, -0.08), (0.11, -0.2), (0.135, -0.31)], 32), parent=sh)
        add_mods(sleeve, subsurf=1, solidify=0.008); setmat(sleeve, sleeve_mat)
        el = new_obj(f'Elbow{s}', None, parent=sh, loc=(0, 0, -0.29))
        vb = new_obj('Vambrace', lathe('Vamb', [(0.0, 0.0), (0.056, 0.0), (0.062, -0.05), (0.056, -0.2), (0.047, -0.25), (0.0, -0.25)], 32), parent=el)
        add_mods(vb, subsurf=1); setmat(vb, gold)
        rg = new_obj('VRing', prim('VR', 'torus', R=0.06, rr=0.008), parent=el, loc=(0, 0, -0.06)); setmat(rg, iron)
        hand = new_obj(f'Hand{s}', None, parent=el, loc=(0, 0, -0.26))
        palm = new_obj('Palm', prim('Palm', 'cube'), parent=hand, loc=(0, 0, -0.045), scale=(0.075, 0.032, 0.085)); add_mods(palm, bevel=0.01, subsurf=1); setmat(palm, iron)
        for k in range(4):
            fx = (k - 1.5) * 0.019
            p1 = new_obj('Finger', None, parent=hand, loc=(fx, 0, -0.088), rot=(-0.35, 0, 0))
            seg1 = new_obj('F1', prim('F1', 'cone', r1=0.0095, r2=0.0085, depth=0.042, segs=12), parent=p1, loc=(0, 0, -0.021)); setmat(seg1, iron)
            p2 = new_obj('Finger2', None, parent=p1, loc=(0, 0, -0.042), rot=(-0.55, 0, 0))
            seg2 = new_obj('F2', prim('F2', 'cone', r1=0.0085, r2=0.0, depth=0.05, segs=12), parent=p2, loc=(0, 0, -0.025)); setmat(seg2, gold)
        th = new_obj('Thumb', prim('Th', 'cone', r1=0.011, r2=0.0, depth=0.06, segs=12), parent=hand, loc=(-s * 0.04, -0.015, -0.05), rot=(-0.4, 0, -s * 0.6)); setmat(th, iron)
        hl = bpy.data.lights.new(f'HandLight{s}', 'POINT'); hl.color = (0.7, 0.45, 1.0); hl.shadow_soft_size = 0.05
        new_obj(f'HandLight{s}', hl, parent=hand, loc=(0, -0.05, -0.08))
        arms.append((s, sh, el, hand, hl))
    for f in range(1, FRAMES + 1):
        t = tof(f); sx, so, ex = arm_pose(t)
        trem = ss(5, 7.4, t) * (1 if t < 7.6 else 0) * 0.02
        for s, sh, el, hand, hl in arms:
            sh.rotation_euler = (sx + math.sin(t * 40 + s) * trem, -s * so, 0); sh.keyframe_insert('rotation_euler', frame=f)
            el.rotation_euler = (ex, 0, 0); el.keyframe_insert('rotation_euler', frame=f)
            g = ss(1.5, 2.6, t) * (max(0.3, 1 - (t - BLAST)) if t > BLAST else 1)
            kf(hl, 'energy', f, g * (3 + ss(4, 7.4, t) * 10) * (0.85 + 0.15 * math.sin(t * 13 + s)))

    # cape (cloth)
    cape = new_obj('Cape', prim('Cape', 'grid', xs=26, ys=44, smooth=True), parent=root)
    me = cape.data
    for v in me.vertices:
        u, w = v.co.x + 0.5, v.co.y + 0.5  # u across, w along (1 = top)
        depth = 1 - w
        x = (u - 0.5) * (0.78 + depth * 0.5)
        z = 1.6 - depth * 1.56
        y = 0.24 - 0.16 * ((u - 0.5) / 0.5) ** 2 * (1 - depth * 0.6) + depth * 0.1
        v.co = (x, y, z)
    uvl = me.uv_layers.new()
    vg = cape.vertex_groups.new(name='pin')
    for v in me.vertices:
        if v.co.z > 1.585: vg.add([v.index], 1.0, 'REPLACE')
    setmat(cape, cape_mat)
    cl = cape.modifiers.new('Cloth', 'CLOTH'); cs = cl.settings
    cs.quality = 8; cs.mass = 0.45; cs.air_damping = 1.2; cs.tension_stiffness = 18; cs.compression_stiffness = 18; cs.shear_stiffness = 6; cs.bending_stiffness = 1.2
    cs.vertex_group_mass = 'pin'
    cl.collision_settings.distance_min = 0.01; cl.point_cache.frame_start = 1; cl.point_cache.frame_end = FRAMES
    add_mods(cape, subsurf=1, solidify=0.006)
    capecol = new_obj('CapeCollider', lathe('CC', [(0.0, 0.0), (0.33, 0.0), (0.36, 1.0), (0.38, 1.45), (0.0, 1.6)], 24), parent=root, scale=(1.05, 0.8, 1))
    capecol.modifiers.new('Collision', 'COLLISION'); capecol.collision.thickness_outer = 0.03; capecol.hide_render = True

    # wind + turbulence driving the cloth
    bpy.ops.object.effector_add(type='WIND', location=(0, -4, 1.2), rotation=(-math.pi / 2, 0, 0)); wind = bpy.context.object; wind.name = 'Wind'
    bpy.ops.object.effector_add(type='TURBULENCE', location=(0, 0, 1.2)); turb = bpy.context.object; turb.name = 'Turbulence'; turb.field.size = 0.6
    for f in range(1, FRAMES + 1):
        t = tof(f); bt = t - BLAST
        kf(wind.field, 'strength', f, 1.0 + ss(2, 4, t) * 3.5 + (40 * math.exp(-bt * 2.5) if bt > 0 else 0))
        kf(turb.field, 'strength', f, 1.0 + ss(2, 4, t) * 3 + (15 * math.exp(-bt * 2) if bt > 0 else 0))

    # ---- magic
    rune_img = bpy.data.images.load(A('rune.png'))
    rune_mat = emissive('RuneGround', (0.45, 0.16, 1.0), 0.0, image=rune_img)
    rune2_mat = emissive('RuneOuter', (0.12, 0.55, 1.0), 0.0, image=rune_img)
    seal_mat = emissive('Seal', (0.7, 0.45, 1.0), 0.0, image=rune_img)
    def uv_plane(name, size):
        me = prim(name, 'grid', xs=1, ys=1, smooth=False); uvl = me.uv_layers.new()
        for poly in me.polygons:
            for li in poly.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co; uvl.data[li].uv = (co.x + 0.5, co.y + 0.5)
        o = new_obj(name, me); o.scale = (size, size, 1); return o
    rune = uv_plane('RuneCircle', 5.0); rune.location = (0, 0, 0.303); setmat(rune, rune_mat)
    rune2 = uv_plane('RuneOuter', 6.6); rune2.location = (0, 0, 0.153); setmat(rune2, rune2_mat)
    for o in (rune, rune2): o.visible_shadow = False
    seal = uv_plane('Seal', 0.95); setmat(seal, seal_mat); seal.visible_shadow = False
    rl = bpy.data.lights.new('RuneLight', 'AREA'); rl.shape = 'DISK'; rl.size = 4.5; rl.color = (0.62, 0.4, 1.0)
    new_obj('RuneLight', rl, loc=(0, 0, 0.32), rot=(math.pi, 0, 0))
    # light shining up from the circle
    rl_up = bpy.data.lights.new('RuneUp', 'AREA'); rl_up.shape = 'DISK'; rl_up.size = 3.0; rl_up.color = (0.62, 0.4, 1.0)
    new_obj('RuneUp', rl_up, loc=(0, -0.6, 0.31))

    # find where the hands meet in the cast pose -> orb anchor
    sc.frame_set(int(6.5 * FPS) + 1); bpy.context.view_layer.update()
    hp = [a[3].matrix_world.translation.copy() for a in arms]
    mid = (hp[0] + hp[1]) / 2
    orb_local = Vector((0, mid.y - 0.13, mid.z - hover(6.5) + 0.02))
    print('hands', hp, 'orb local', orb_local)

    orb = new_obj('Orb', None)
    core = new_obj('OrbCore', prim('Core', 'uvsphere', r=0.45), parent=orb); setmat(core, emissive('OrbCore', (1.0, 0.92, 1.0), 60.0))
    swirl = bpy.data.materials.new('OrbSwirl'); b = N(swirl)
    out = b.n('ShaderNodeOutputMaterial'); vol = b.n('ShaderNodeVolumePrincipled')
    tc = b.n('ShaderNodeTexCoord'); nz = b.n('ShaderNodeTexNoise', noise_dimensions='4D', in_Scale=2.5, in_Detail=6.0, in_Distortion=1.5)
    b.l(tc.outputs['Object'], nz.inputs['Vector'])
    grad = b.n('ShaderNodeTexGradient', gradient_type='SPHERICAL'); b.l(tc.outputs['Object'], grad.inputs['Vector'])
    m1 = b.n('ShaderNodeMath', operation='MULTIPLY'); b.l(nz.outputs['Fac'], m1.inputs[0]); b.l(grad.outputs['Fac'], m1.inputs[1])
    cut = b.n('ShaderNodeMapRange', in_From_Min=0.15, in_From_Max=0.45); b.l(m1.outputs['Value'], cut.inputs['Value'])
    e = b.n('ShaderNodeMath', operation='MULTIPLY'); e.inputs[1].default_value = 140.0; b.l(cut.outputs['Result'], e.inputs[0])
    vol.inputs['Density'].default_value = 0.0; vol.inputs['Emission Color'].default_value = (0.55, 0.3, 1.0, 1)
    b.l(e.outputs['Value'], vol.inputs['Emission Strength']); b.l(vol.outputs['Volume'], out.inputs['Volume'])
    for f in range(1, FRAMES + 1): kf_socket(nz.inputs['W'], f, f * 0.12)
    shell = new_obj('OrbShell', prim('Shell', 'ico', sub=3, r=1.0), parent=orb); setmat(shell, swirl); shell.visible_shadow = False
    ol = bpy.data.lights.new('OrbLight', 'POINT'); ol.color = (0.7, 0.45, 1.0); ol.shadow_soft_size = 0.05
    orbl = new_obj('OrbLight', ol)
    for f in range(1, FRAMES + 1):
        t = tof(f); bt = t - BLAST; r = orb_radius(t)
        p = Vector((0, orb_local.y, orb_local.z + hover(t)))
        if bt > 0: p.y -= bt * 20
        orb.location = p; orb.scale = (max(r, 1e-4),) * 3; orb.rotation_euler = (t * 1.3, t * 0.7, t * 2.1)
        orb.keyframe_insert('location', frame=f); orb.keyframe_insert('scale', frame=f); orb.keyframe_insert('rotation_euler', frame=f)
        orb.hide_render = r < 0.002; orb.keyframe_insert('hide_render', frame=f)
        for ch in orb.children:
            ch.hide_render = r < 0.002; ch.keyframe_insert('hide_render', frame=f)
        orbl.location = (0, orb_local.y, orb_local.z + hover(t)); orbl.keyframe_insert('location', frame=f)
        grow = ss(3.9, 7.3, t)
        kf(ol, 'energy', f, (0 if bt > 0 else grow) * (90 + 40 * math.sin(t * 13)) + (3000 * math.exp(-bt * 5) if bt > 0 else 0))
        # runes
        on = ss(1.4, 2.6, t) * ((0.6 + 0.4 * math.exp(-bt * 2)) if bt > 0 else 1)
        kf_socket(rune_mat.node_tree.nodes['EMIT'].inputs['Strength'], f, on * (4 + 0.7 * math.sin(t * 9)))
        kf_socket(rune2_mat.node_tree.nodes['EMIT'].inputs['Strength'], f, ss(2.2, 3.4, t) * 2.5 * ((math.exp(-bt * 0.8) * 0.7 + 0.3) if bt > 0 else 1))
        rune.rotation_euler = (0, 0, t * 0.3); rune.keyframe_insert('rotation_euler', frame=f)
        rs = 0.4 + 0.6 * ease_out((t - 1.4) / 1.4) + (bt * 0.06 if bt > 0 else 0)
        rune.scale = (5 * rs, 5 * rs, 1); rune.keyframe_insert('scale', frame=f)
        rune2.rotation_euler = (0, 0, -t * 0.15); rune2.keyframe_insert('rotation_euler', frame=f)
        kf(rl, 'energy', f, on * 120 + (2500 * math.exp(-bt * 4) if bt > 0 else 0))
        kf(rl_up, 'energy', f, on * 60)
        # spell seal
        son = ss(4.4, 5.4, t)
        seal.location = (0, orb_local.y - 0.22 - (ease_out(bt / 0.5) * 1.0 if bt > 0 else 0), orb_local.z + hover(t))
        seal.rotation_euler = (math.pi / 2, t * 1.1, 0)
        k = 0.3 + son * 0.7 + (ease_out(bt / 0.5) * 1.3 if bt > 0 else 0); seal.scale = (0.95 * k, 0.95 * k, 1)
        seal.keyframe_insert('location', frame=f); seal.keyframe_insert('rotation_euler', frame=f); seal.keyframe_insert('scale', frame=f)
        kf_socket(seal_mat.node_tree.nodes['EMIT'].inputs['Strength'], f, son * (max(0, 1 - bt / 0.45) if bt > 0 else (7 + math.sin(t * 20))) )
        # eyes / gem
        eye = 0.4 if t < 0.6 else 0.4 + ss(0.6, 1.0, t) * 38 + math.sin(t * 6) * 5 * ss(1, 2, t) + (30 * math.exp(-bt * 2) if bt > 0 else 0)
        kf_socket(eye_mat.node_tree.nodes['EMIT'].inputs['Strength'], f, eye)
        kf_socket(gem_mat.node_tree.nodes['EMIT'].inputs['Strength'], f, 1.5 + ss(1.5, 3, t) * 14 + math.sin(t * 5) * 2)
        # exposure kick on the blast
        sc.view_settings.exposure = (1.1 * math.exp(-bt * 4) if bt > 0 else 0); sc.view_settings.keyframe_insert('exposure', frame=f)

    # floating debris
    for o in floaters:
        for f in range(1, FRAMES + 1):
            t = tof(f); bt = t - BLAST
            lift = ss(2.8 + o['delay'], 6.2 + o['delay'], t)
            a = o['a'] + lift * 0.6 + t * 0.05 * lift; rr = o['rr']
            if bt > 0: rr += ease_out(bt / 1.4) * (0.8 + o['sz'] * 2) * (0.5 if math.sin(a) < 0 else 1.6)
            o.location = (math.cos(a) * rr, math.sin(a) * rr, 0.3 + o['sz'] * 0.3 + lift * o['rise'] + math.sin(t * 1.3 + o['ph']) * 0.06 * lift)
            sp = o['spin']; o.rotation_euler = (sp[0] * t * lift * 2, sp[1] * t * lift * 2, sp[2] * t * lift)
            o.keyframe_insert('location', frame=f); o.keyframe_insert('rotation_euler', frame=f)

    # shock ring
    shock = new_obj('Shock', prim('Shock', 'torus', R=1.0, rr=0.012, M=128, N=8)); setmat(shock, emissive('Shock', (0.75, 0.55, 1.0), 0.0))
    shock.visible_shadow = False
    for f in range(1, FRAMES + 1):
        t = tof(f); bt = t - BLAST
        s = 0.3 + ease_out(bt / 1.6) * 14 if bt > 0 else 0.01
        shock.location = (0, 0, 0.33); shock.scale = (s, s, 1 + s * 0.5); shock.keyframe_insert('location', frame=f); shock.keyframe_insert('scale', frame=f)
        kf_socket(shock.data.materials[0].node_tree.nodes['EMIT'].inputs['Strength'], f, 40 * max(0, 1 - bt / 1.6) if bt > 0 else 0)

    # lightning: geometry-nodes bolts from each hand (and two from the floor) into the orb
    bolt_mat = emissive('Bolt', (0.8, 0.65, 1.0), 60.0)
    ng = bpy.data.node_groups.new('Bolt', 'GeometryNodeTree')
    ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    ng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    s_from = ng.interface.new_socket('From', in_out='INPUT', socket_type='NodeSocketObject')
    s_to = ng.interface.new_socket('To', in_out='INPUT', socket_type='NodeSocketObject')
    s_seed = ng.interface.new_socket('Seed', in_out='INPUT', socket_type='NodeSocketFloat')
    s_amp = ng.interface.new_socket('Amp', in_out='INPUT', socket_type='NodeSocketFloat')
    nn = ng.nodes; L = ng.links.new
    gi = nn.new('NodeGroupInput'); go = nn.new('NodeGroupOutput')
    oi1 = nn.new('GeometryNodeObjectInfo'); oi2 = nn.new('GeometryNodeObjectInfo')
    oi1.transform_space = oi2.transform_space = 'ORIGINAL'
    L(gi.outputs['From'], oi1.inputs['Object']); L(gi.outputs['To'], oi2.inputs['Object'])
    line = nn.new('GeometryNodeCurvePrimitiveLine'); L(oi1.outputs['Location'], line.inputs['Start']); L(oi2.outputs['Location'], line.inputs['End'])
    res = nn.new('GeometryNodeResampleCurve'); res.inputs['Count'].default_value = 22; L(line.outputs['Curve'], res.inputs['Curve'])
    pos = nn.new('GeometryNodeInputPosition'); par = nn.new('GeometryNodeSplineParameter')
    noise = nn.new('ShaderNodeTexNoise'); noise.noise_dimensions = '4D'; noise.inputs['Scale'].default_value = 3.0; noise.inputs['Detail'].default_value = 3.0
    L(pos.outputs['Position'], noise.inputs['Vector']); L(gi.outputs['Seed'], noise.inputs['W'])
    sub = nn.new('ShaderNodeVectorMath'); sub.operation = 'SUBTRACT'; sub.inputs[1].default_value = (0.5, 0.5, 0.5)
    L(noise.outputs['Color'], sub.inputs[0])
    sinm = nn.new('ShaderNodeMath'); sinm.operation = 'MULTIPLY'; sinm.inputs[1].default_value = math.pi; L(par.outputs['Factor'], sinm.inputs[0])
    sinn = nn.new('ShaderNodeMath'); sinn.operation = 'SINE'; L(sinm.outputs['Value'], sinn.inputs[0])
    amp = nn.new('ShaderNodeMath'); amp.operation = 'MULTIPLY'; L(sinn.outputs['Value'], amp.inputs[0]); L(gi.outputs['Amp'], amp.inputs[1])
    sc_ = nn.new('ShaderNodeVectorMath'); sc_.operation = 'SCALE'; L(sub.outputs['Vector'], sc_.inputs[0]); L(amp.outputs['Value'], sc_.inputs['Scale'])
    sp = nn.new('GeometryNodeSetPosition'); L(res.outputs['Curve'], sp.inputs['Geometry']); L(sc_.outputs['Vector'], sp.inputs['Offset'])
    prof_ = nn.new('GeometryNodeCurvePrimitiveCircle'); prof_.inputs['Resolution'].default_value = 6; prof_.inputs['Radius'].default_value = 0.006
    c2m = nn.new('GeometryNodeCurveToMesh'); L(sp.outputs['Geometry'], c2m.inputs['Curve']); L(prof_.outputs['Curve'], c2m.inputs['Profile Curve'])
    sm = nn.new('GeometryNodeSetMaterial'); sm.inputs['Material'].default_value = bolt_mat; L(c2m.outputs['Mesh'], sm.inputs['Geometry'])
    L(sm.outputs['Geometry'], go.inputs['Geometry'])
    ids = {it.name: it.identifier for it in ng.interface.items_tree if getattr(it, 'in_out', '') == 'INPUT'}
    floor_pts = [new_obj('BoltFloorA', None, loc=(0.9, -1.2, 0.32)), new_obj('BoltFloorB', None, loc=(-1.0, -1.0, 0.32))]
    srcs = [arms[0][3], arms[1][3], arms[0][3], arms[1][3], floor_pts[0], floor_pts[1]]
    for i, src in enumerate(srcs):
        bo = new_obj(f'Bolt{i}', bpy.data.meshes.new(f'BoltMesh{i}'))
        md = bo.modifiers.new('Bolt', 'NODES'); md.node_group = ng
        md[ids['From']] = src; md[ids['To']] = orbl
        md[ids['Amp']] = 0.12 if i < 4 else 0.35
        bo.cycles.use_motion_blur = False; bo.visible_shadow = False
        rnd = random.Random(i * 99)
        for f in range(1, FRAMES + 1):
            t = tof(f)
            on = ss(4.2, 4.8, t) > 0.01 and t < BLAST and rnd.random() > (0.3 if i < 2 else 0.6)
            bo.hide_render = not on; bo.keyframe_insert('hide_render', frame=f)
            md[ids['Seed']] = f * 3.7 + i * 11.3; bo.keyframe_insert(f'modifiers["Bolt"]["{ids["Seed"]}"]', frame=f)
        for fc in bo.animation_data.action.fcurves:
            for kp in fc.keyframe_points: kp.interpolation = 'CONSTANT'

    # ---- point-cloud particles (energy motes, sparks, embers) -- positions written by a frame handler
    mote_mat = bpy.data.materials.new('Mote'); b = N(mote_mat)
    out = b.n('ShaderNodeOutputMaterial'); em = b.n('ShaderNodeEmission'); at = b.n('ShaderNodeAttribute', attribute_name='glow')
    atc = b.n('ShaderNodeAttribute', attribute_name='tint')
    b.l(atc.outputs['Color'], em.inputs['Color']); b.l(at.outputs['Fac'], em.inputs['Strength']); b.l(em.outputs['Emission'], out.inputs['Surface'])
    png = bpy.data.node_groups.new('ToPoints', 'GeometryNodeTree')
    png.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    png.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    rsock = png.interface.new_socket('Radius', in_out='INPUT', socket_type='NodeSocketFloat')
    gi = png.nodes.new('NodeGroupInput'); go = png.nodes.new('NodeGroupOutput')
    m2p = png.nodes.new('GeometryNodeMeshToPoints'); smt = png.nodes.new('GeometryNodeSetMaterial'); smt.inputs['Material'].default_value = mote_mat
    png.links.new(gi.outputs['Geometry'], m2p.inputs['Mesh']); png.links.new(gi.outputs['Radius'], m2p.inputs['Radius'])
    png.links.new(m2p.outputs['Points'], smt.inputs['Geometry']); png.links.new(smt.outputs['Geometry'], go.inputs['Geometry'])
    for name, n, rad in [('Motes', 900, 0.0045), ('Embers', 300, 0.005)]:
        me = bpy.data.meshes.new(name); me.vertices.add(n)
        me.attributes.new('glow', 'FLOAT', 'POINT'); me.attributes.new('tint', 'FLOAT_COLOR', 'POINT')
        o = new_obj(name, me); md = o.modifiers.new('ToPoints', 'NODES'); md.node_group = png
        md[[it.identifier for it in png.interface.items_tree if getattr(it, 'name', '') == 'Radius'][0]] = rad
        o.visible_shadow = False; o.cycles.use_motion_blur = False
    sc['orb_y'] = orb_local.y; sc['orb_z'] = orb_local.z

    # ---- camera (look-at path + shake + DOF)
    cd = bpy.data.cameras.new('Cam'); cd.lens = 40; cd.sensor_width = 36; cd.dof.use_dof = True; cd.dof.aperture_fstop = 2.2
    cam = new_obj('Camera', cd); sc.camera = cam
    keys = [(0.0, (0.35, -9.0, 0.95), (0, 0, 1.85)), (3.4, (-2.2, -5.9, 1.25), (0, 0, 1.7)), (7.45, (-2.1, -3.7, 1.95), (0, -0.35, 1.7)),
            (8.2, (-1.6, -5.0, 1.75), (0, -0.2, 1.7)), (10.0, (0.7, -5.6, 1.35), (0, 0, 1.8))]
    def cam_at(t):
        i = 0
        while i < len(keys) - 2 and t > keys[i + 1][0]: i += 1
        (ta, pa, la), (tb, pb, lb) = keys[i], keys[i + 1]
        k = ss(ta, tb, t)
        return Vector([lerp(a, b, k) for a, b in zip(pa, pb)]), Vector([lerp(a, b, k) for a, b in zip(la, lb)])
    for f in range(1, FRAMES + 1):
        t = tof(f); bt = t - BLAST; p, l = cam_at(t)
        shake = (max(0, 1 - bt / 1.2) * 0.06 if bt > 0 else ss(6.0, 7.5, t) * 0.008)
        p += Vector((math.sin(t * 61) * shake, math.sin(t * 53 + 2) * shake * 0.5, math.sin(t * 47 + 1) * shake))
        cam.location = p; cam.rotation_euler = (l - p).to_track_quat('-Z', 'Y').to_euler()
        cam.keyframe_insert('location', frame=f); cam.keyframe_insert('rotation_euler', frame=f)
        cd.dof.focus_distance = (Vector((0, 0, 1.9 + hover(t))) - p).length - 0.1; cd.dof.keyframe_insert('focus_distance', frame=f)

    # ---- compositor: bloom + subtle lens dispersion + vignette
    sc.use_nodes = True; nt = sc.node_tree; nt.nodes.clear()
    rl_ = nt.nodes.new('CompositorNodeRLayers'); comp = nt.nodes.new('CompositorNodeComposite')
    glare = nt.nodes.new('CompositorNodeGlare')
    try: glare.glare_type = 'BLOOM'
    except Exception: glare.glare_type = 'FOG_GLOW'
    for k, v in [('quality', 'HIGH'), ('threshold', 1.2), ('size', 8), ('mix', -0.55)]:
        try: setattr(glare, k, v)
        except Exception: pass
    lens = nt.nodes.new('CompositorNodeLensdist');
    try: lens.inputs['Dispersion'].default_value = 0.012
    except Exception: pass
    ell = nt.nodes.new('CompositorNodeEllipseMask'); ell.width = 1.15; ell.height = 1.25
    blur = nt.nodes.new('CompositorNodeBlur'); blur.size_x = blur.size_y = 220
    mapv = nt.nodes.new('CompositorNodeMapRange'); mapv.inputs[1].default_value = 0; mapv.inputs[2].default_value = 1; mapv.inputs[3].default_value = 0.55; mapv.inputs[4].default_value = 1.0
    mul = nt.nodes.new('CompositorNodeMixRGB'); mul.blend_type = 'MULTIPLY'
    L = nt.links.new
    mistmap = nt.nodes.new('CompositorNodeMapRange'); mistmap.inputs[1].default_value = 0; mistmap.inputs[2].default_value = 1
    mistmap.inputs[3].default_value = 0.0; mistmap.inputs[4].default_value = 0.62
    fogmix = nt.nodes.new('CompositorNodeMixRGB'); fogmix.inputs[2].default_value = (0.045, 0.04, 0.075, 1)
    L(rl_.outputs['Mist'], mistmap.inputs[0]); L(mistmap.outputs[0], fogmix.inputs[0]); L(rl_.outputs['Image'], fogmix.inputs[1])
    L(fogmix.outputs['Image'], glare.inputs['Image']); L(glare.outputs['Image'], lens.inputs['Image'])
    L(ell.outputs['Mask'], blur.inputs['Image']); L(blur.outputs['Image'], mapv.inputs[0])
    L(lens.outputs['Image'], mul.inputs[1]); L(mapv.outputs[0], mul.inputs[2]); L(mul.outputs['Image'], comp.inputs['Image'])

    # ---- bake cloth to disk
    bpy.ops.wm.save_as_mainfile(filepath=out_path)
    for o in (robe, cape):
        o.modifiers['Cloth'].point_cache.use_disk_cache = True
    bpy.ops.wm.save_as_mainfile(filepath=out_path)
    sc.frame_set(1)
    with bpy.context.temp_override(scene=sc):
        bpy.ops.ptcache.bake_all(bake=True)
    bpy.ops.wm.save_as_mainfile(filepath=out_path)
    print('BUILD OK', out_path)

# ------------------------------------------------------------------ particle handler
_SEED = None
def _seed():
    global _SEED
    if _SEED is None:
        r = random.Random(7)
        motes = [(r.uniform(0, 6.283), r.uniform(1.0, 3.6), r.uniform(0, 3.2), r.uniform(0.25, 0.7), r.random(), r.random(),
                  Vector((r.uniform(-1, 1), r.uniform(-1, 0.6), r.uniform(-0.5, 1))).normalized(), r.uniform(2, 9)) for _ in range(900)]
        embers = [(r.uniform(-9, 9), r.uniform(-6, 9), r.uniform(0.05, 0.16), r.random(), r.uniform(0, 6), r.random()) for _ in range(300)]
        _SEED = (motes, embers)
    return _SEED

def particles(scene, *_):
    t = (scene.frame_current + scene.frame_subframe - 1) / FPS
    motes, embers = _seed()
    oy, oz = scene['orb_y'], scene['orb_z'] + hover(t)
    bt = t - BLAST; grow = ss(3.9, 7.3, t); on = ss(1.8, 3.2, t)
    me = bpy.data.objects['Motes'].data
    co = []; glow = []; tint = []
    for a0, r0, h0, spd, off, hue, d, bsp in motes:
        if bt <= 0:
            p = (t * spd + off) % 1.0
            r = r0 * (1 - p) ** 1.6; ang = a0 + p * 7 + t * 0.4
            co += [math.cos(ang) * r, oy * p + math.sin(ang) * r, lerp(0.35 + h0 * 0.5, oz, p ** 0.7)]
            g = on * math.sin(math.pi * p) * (4 + 10 * grow)
            c = (0.55 + 0.45 * p * (hue > 0.6), 0.35 + 0.5 * p * (hue > 0.6) + (0.4 if hue > 0.85 else 0), 1.0)
        else:
            k = ease_out(bt / 2.0) * bsp
            co += [d.x * k, oy + d.y * k - k * 0.4, max(0.33, oz + d.z * k - bt * bt * 0.8)]
            g = 40 * math.exp(-bt * 1.8)
            c = (0.8, 0.6, 1.0) if hue > 0.4 else (0.5, 0.8, 1.0)
        glow.append(g); tint += [c[0], c[1], c[2], 1.0]
    me.vertices.foreach_set('co', co); me.attributes['glow'].data.foreach_set('value', glow); me.attributes['tint'].data.foreach_set('color', tint); me.update()
    me = bpy.data.objects['Embers'].data
    co = []; glow = []; tint = []
    for x, y, spd, off, sway, warm in embers:
        p = (t * spd * (1 + 0.6 * ss(2, 5, t)) + off) % 1.0
        co += [x + math.sin(t + sway) * 0.3, y, p * 6.5]
        glow.append(math.sin(math.pi * p) * 3.5)
        k = ss(1.5, 4, t) * warm
        tint += [lerp(1.0, 0.7, k), lerp(0.45, 0.45, k), lerp(0.15, 1.0, k), 1.0]
    me.vertices.foreach_set('co', co); me.attributes['glow'].data.foreach_set('value', glow); me.attributes['tint'].data.foreach_set('color', tint); me.update()

def setup_device():
    """Use the best available GPU (OptiX/CUDA/HIP/Metal/oneAPI); fall back to CPU."""
    sc = bpy.context.scene
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for kind in ('OPTIX', 'CUDA', 'HIP', 'METAL', 'ONEAPI'):
            try: prefs.compute_device_type = kind
            except Exception: continue
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == kind]
            if gpus:
                for d in prefs.devices: d.use = d.type == kind
                sc.cycles.device = 'GPU'
                print('RENDER DEVICE:', kind, [d.name for d in gpus]); return True
    except Exception as e:
        print('GPU setup failed:', e)
    sc.cycles.device = 'CPU'; print('RENDER DEVICE: CPU'); return False

def render(start, end, samples, out_prefix):
    sc = bpy.context.scene
    if setup_device() and '--hq' in sys.argv:
        bpy.data.objects['Fog'].hide_render = False   # real volumetric light shafts on GPU
    sc.cycles.samples = samples
    sc.render.use_lock_interface = True
    bpy.app.handlers.frame_change_pre.clear(); bpy.app.handlers.frame_change_pre.append(particles)
    sc.render.filepath = out_prefix
    sc.frame_start, sc.frame_end = start, end
    bpy.ops.render.render(animation=True)

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    if argv[0] == 'build': build(argv[1], argv[2])
    elif argv[0] == 'render': render(int(argv[1]), int(argv[2]), int(argv[3]), argv[4])
    elif argv[0] == 'stills':
        sc = bpy.context.scene; sc.cycles.samples = int(argv[1]); sc.render.use_lock_interface = True
        setup_device()
        bpy.app.handlers.frame_change_pre.clear(); bpy.app.handlers.frame_change_pre.append(particles)
        for f in [int(x) for x in argv[3:]]:
            sc.frame_set(f); sc.render.filepath = f'{argv[2]}{f:04d}.png'; bpy.ops.render.render(write_still=True)
