"""Tiny dependency-free GLB (binary glTF 2.0) reader, used by pipeline.py and the tests.

read_glb(path)            -> (gltf_json: dict, bin_chunk: bytes)
node_world_matrices(j)    -> {node_index: 4x4 row-major list}, walking the default scene
positions(j, bin, acc_i)  -> list of (x, y, z) floats for a POSITION accessor
named_node_bounds(path)   -> {node_name: (min_xyz, max_xyz)} in glTF world space (Y-up),
                             merging every mesh at or below each named node

Usage (from bim/): python -m truesite_bim.glb_reader models/site/model.glb
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

GLB_MAGIC = b"glTF"
CHUNK_JSON = 0x4E4F534A  # "JSON"
CHUNK_BIN = 0x004E4942  # "BIN\0"
_COMPONENT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
_NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_glb(path: str | Path) -> tuple[dict, bytes]:
    data = Path(path).read_bytes()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != GLB_MAGIC or version != 2:
        raise ValueError(f"not a glTF 2.0 binary: {magic!r} v{version}")
    if length != len(data):
        raise ValueError(f"header length {length} != file size {len(data)}")
    off, j, binchunk = 12, None, b""
    while off < length:
        clen, ctype = struct.unpack_from("<II", data, off)
        body = data[off + 8 : off + 8 + clen]
        if ctype == CHUNK_JSON:
            j = json.loads(body.decode("utf-8"))
        elif ctype == CHUNK_BIN:
            binchunk = body
        off += 8 + clen
    if j is None:
        raise ValueError("GLB has no JSON chunk")
    return j, binchunk


def _matmul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def _identity():
    return [[1.0 if i == j else 0.0 for j in range(4)] for i in range(4)]


def node_local_matrix(node: dict) -> list[list[float]]:
    """Row-major 4x4 from a glTF node (column-major 'matrix', or TRS)."""
    if "matrix" in node:
        m = node["matrix"]
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    t = node.get("translation", [0.0, 0.0, 0.0])
    x, y, z, w = node.get("rotation", [0.0, 0.0, 0.0, 1.0])
    s = node.get("scale", [1.0, 1.0, 1.0])
    r = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]
    return [[r[i][0] * s[0], r[i][1] * s[1], r[i][2] * s[2], t[i]] for i in range(3)] + [[0.0, 0.0, 0.0, 1.0]]


def node_world_matrices(j: dict) -> dict[int, list[list[float]]]:
    out: dict[int, list[list[float]]] = {}
    nodes = j.get("nodes", [])

    def walk(i, parent):
        m = _matmul(parent, node_local_matrix(nodes[i]))
        out[i] = m
        for c in nodes[i].get("children", []):
            walk(c, m)

    scene = j["scenes"][j.get("scene", 0)]
    for root in scene["nodes"]:
        walk(root, _identity())
    return out


def node_parents(j: dict) -> dict[int, int]:
    return {c: i for i, n in enumerate(j.get("nodes", [])) for c in n.get("children", [])}


def positions(j: dict, binchunk: bytes, accessor_index: int) -> list[tuple[float, ...]]:
    acc = j["accessors"][accessor_index]
    view = j["bufferViews"][acc["bufferView"]]
    fmt, size = _COMPONENT[acc["componentType"]]
    n = _NCOMP[acc["type"]]
    stride = view.get("byteStride") or size * n
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    return [struct.unpack_from("<" + fmt * n, binchunk, base + k * stride) for k in range(acc["count"])]


def _transform(m, p):
    return tuple(m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3] for i in range(3))


def mesh_node_world_points(j: dict, binchunk: bytes) -> dict[int, list[tuple[float, float, float]]]:
    """World-space vertex positions for every node that carries a mesh."""
    world = node_world_matrices(j)
    out = {}
    for i, node in enumerate(j.get("nodes", [])):
        if "mesh" not in node or i not in world:
            continue
        pts = []
        for prim in j["meshes"][node["mesh"]]["primitives"]:
            pts += [_transform(world[i], p) for p in positions(j, binchunk, prim["attributes"]["POSITION"])]
        out[i] = pts
    return out


def named_node_bounds(path: str | Path) -> dict[str, tuple[tuple[float, ...], tuple[float, ...]]]:
    """AABB in glTF world space for each node name, merging meshes on that node or its descendants
    (the 'nearest named ancestor' rule the web app uses for ID-buffer picking)."""
    j, b = read_glb(path)
    parents = node_parents(j)
    nodes = j.get("nodes", [])
    acc: dict[str, list] = {}
    for i, pts in mesh_node_world_points(j, b).items():
        k = i
        while "name" not in nodes[k] and k in parents:
            k = parents[k]
        name = nodes[k].get("name", f"#node{i}")
        acc.setdefault(name, []).extend(pts)
    return {
        name: (tuple(min(p[a] for p in pts) for a in range(3)), tuple(max(p[a] for p in pts) for a in range(3)))
        for name, pts in acc.items()
    }


if __name__ == "__main__":
    import sys

    jj, _ = read_glb(sys.argv[1])
    print(json.dumps({"asset": jj["asset"], "nodes": len(jj.get("nodes", [])), "meshes": len(jj.get("meshes", []))}))
    for name, (lo, hi) in sorted(named_node_bounds(sys.argv[1]).items()):
        print(name, [round(v, 4) for v in lo], [round(v, 4) for v in hi])
