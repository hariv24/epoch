# Inlines url("x.svg") mask/background assets of a theme as data: URIs (CSS masks are CORS-blocked over file://).
# usage: python3 inline.py <theme dir>   reads theme.src.css, writes theme.css
import sys, re, os, urllib.parse
d=sys.argv[1]
src=open(os.path.join(d,'theme.src.css')).read()
def rep(m):
    f=m.group(1); s=open(os.path.join(d,f)).read()
    s=re.sub(r'<!--.*?-->','',s,flags=re.S); s=re.sub(r'\s+',' ',s).replace('> <','><').strip()
    enc=urllib.parse.quote(s, safe=" =:/;,.-_()'")  # keep it mostly readable
    enc=enc.replace("'","%27")
    return 'url("data:image/svg+xml,'+enc+'")'
out=re.sub(r'url\("([\w-]+\.svg)"\)',rep,src)
hdr='/* GENERATED from theme.src.css by inlining bg*.svg as data: URIs (CSS masks are CORS-blocked over file://). Edit theme.src.css. */\n'
open(os.path.join(d,'theme.css'),'w').write(hdr+out)
print(d, len(out))
