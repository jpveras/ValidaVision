#!/usr/bin/env python3
"""Gera public/vv-tema-auto.css: versões escuras das cores fixas de cada página.

Uso:  pip install tinycss2 && python3 tools/gerar-tema-escuro.py
Rode de novo sempre que mudar cores no CSS das páginas.

Regras:
- Fundos/bordas claros (luminosidade alta) viram tons escuros, mantendo o matiz.
- Textos escuros viram claros. Cores médias (botão verde, etc.) ficam iguais.
- Variáveis (--page, --ink...) são definidas à mão em vv-tema.css.
- Seletores com "qr" ficam claros (o QR Code precisa de fundo branco para ler).
- Cada página fica isolada por html[data-pagina="..."]; só vale na tela (não no PDF/impressão).
"""
import colorsys, pathlib, re, tinycss2

RAIZ = pathlib.Path(__file__).resolve().parent.parent / "public"
PAGINAS = ["analise", "elogios", "elogiar", "elogios-moderacao", "sentimento", "sentimento-gestora"]
TEXTO = {"color", "fill", "stroke", "caret-color", "-webkit-text-fill-color", "text-decoration-color"}
BORDA = re.compile(r"^(border|outline)")
FUNDO = re.compile(r"^(background|box-shadow)")

def hsl(r, g, b):
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    return h, s, l

def para_hex(h, s, l, a=None):
    r, g, b = (round(x * 255) for x in colorsys.hls_to_rgb(h, max(0, min(1, l)), max(0, min(1, s))))
    return f"rgba({r},{g},{b},{a})" if a is not None else f"#{r:02x}{g:02x}{b:02x}"

def parse(tok):
    t = tok.strip()
    m = re.fullmatch(r"#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})", t)
    if m:
        x = m.group(1)
        if len(x) == 3: x = "".join(c * 2 for c in x)
        return int(x[0:2], 16), int(x[2:4], 16), int(x[4:6], 16), None
    m = re.fullmatch(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)", t)
    if m:
        return int(m[1]), int(m[2]), int(m[3]), (m[4] if m[4] is not None else None)
    if t.lower() == "white": return 255, 255, 255, None
    return None

def escurece(cor, prop):
    p = parse(cor)
    if not p: return None
    r, g, b, a = p
    h, s, l = hsl(r, g, b)
    if prop in TEXTO:
        if l > 0.55: return None
        return para_hex(h, min(s, 0.75), 0.95 - l * 0.6, a)
    if BORDA.match(prop):
        if l < 0.7: return None
        if s < 0.08: h, s = 0.52, 0.6
        return para_hex(h, s * 0.35, 0.22 + (l - 0.7) * 0.25, a)
    if FUNDO.match(prop):
        if a is not None and prop.startswith("box-shadow"): return None
        if l < 0.78: return None
        if a is not None and float(a) < 0.5 and r == g == b == 255:
            return para_hex(0, 0, 1, a)  # brilho branco translúcido: deixa
        if s < 0.08: h, s = 0.52, 0.66  # cinzas/branco: mesmo tom azul-petróleo do tema
        return para_hex(h, s * 0.45, 0.09 + (l - 0.78) * 0.30, a)
    return None

COR = re.compile(r"#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)|\bwhite\b")

def converte_valor(prop, valor):
    mudou = False
    def troca(m):
        nonlocal mudou
        n = escurece(m.group(0), prop)
        if n: mudou = True; return n
        return m.group(0)
    novo = COR.sub(troca, valor)
    return novo if mudou else None

def regras(css, escopo, saida, media=None):
    for r in tinycss2.parse_stylesheet(css, skip_comments=True, skip_whitespace=True):
        if r.type == "at-rule" and r.lower_at_keyword == "media":
            cond = tinycss2.serialize(r.prelude).strip()
            if "print" in cond: continue
            regras(tinycss2.serialize(r.content or []), escopo, saida, cond)
            continue
        if r.type != "qualified-rule": continue
        sel = tinycss2.serialize(r.prelude).strip()
        if "qr" in sel.lower() or sel.startswith("@"): continue
        decls = []
        for d in tinycss2.parse_declaration_list(r.content, skip_comments=True, skip_whitespace=True):
            if d.type != "declaration" or d.name.startswith("--"): continue
            v = converte_valor(d.lower_name, tinycss2.serialize(d.value).strip())
            if v: decls.append(f"{d.lower_name}:{v}{' !important' if d.important else ''}")
        if not decls: continue
        partes = []
        for s in sel.split(","):
            s = s.strip()
            s2 = re.sub(r"^(:root|html)\b", "", s).strip()
            if s2.startswith("body") or s2 == "": partes.append(f"{escopo}{' ' + s2 if s2 else ''}")
            else: partes.append(f"{escopo} {s2}")
        saida.append((media, ",".join(partes) + "{" + ";".join(decls) + "}"))

def main():
    saida = []
    regras((RAIZ / "vv-base.css").read_text(), 'html[data-tema="escuro"]', saida)
    for p in PAGINAS:
        html = (RAIZ / f"{p}.html").read_text()
        for bloco in re.findall(r"<style>(.*?)</style>", html, re.S):
            regras(bloco, f'html[data-tema="escuro"][data-pagina="{p}"]', saida)
    linhas = ["/* GERADO por tools/gerar-tema-escuro.py — não edite à mão. Ajustes finos: vv-tema.css */", "@media screen{"]
    for media, regra in saida:
        linhas.append(f"@media {media}{{{regra}}}" if media else regra)
    linhas.append("}")
    (RAIZ / "vv-tema-auto.css").write_text("\n".join(linhas) + "\n")
    print(len(saida), "regras")

main()
