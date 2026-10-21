import json
OX,OY=120,190  # origin shift
def Lx(y): return 130-(y-195)*8/888
def D(x): return 761+(x-124)*0.0535
def G(x): return 449-0.2607*(x-417)
def B(x): return 477-0.288*(x-332)
def Dv(y): return 679-(y-388)*0.035
def V(y): return 666-(y-791)*10/296
R=860
def P(*pts): return [[round(x-OX,1),round(y-OY,1)] for x,y in pts]
riv13=[(190,624),(208,674),(223,724)]
lots=[]
def lot(n,ha,poly,subs=None):
    lots.append({"num":n,"ha":ha,"nombre":"","obs":"","poly":P(*poly),"subs":[{"id":k,"ha":h,"poly":P(*p)} for k,h,p in (subs or [])]})
lot(21,300,[(130,195),(324,197),(324,267),(255,267),(255,336),(Lx(336),336)])
lot(25,367,[(255,267),(324,267),(324,668),(255,668)])
lot(20,426,[(Lx(336),336),(255,336),(255,589),(Lx(589),589)],[
 ("a",236,[(Lx(336),336),(255,336),(255,481),(Lx(481),481)]),
 ("b",190,[(Lx(481),481),(255,481),(255,589),(Lx(589),589)])])
lot(22,316,[(324,197),(415,200),(415,B(415)),(331,477),(324,491)])
lot(23,628,[(415,200),(683,205),(683,G(683)),(415,G(415))],[
 ("a",150,[(415,200),(683,205),(683,257),(415,250)]),
 ("b",148,[(415,250),(683,257),(683,304),(415,300)]),
 ("c",147,[(415,300),(683,304),(683,354),(415,348)]),
 ("d",183,[(415,348),(683,354),(683,G(683)),(415,G(415))])])
lot(24,270,[(683,205),(813,207),(R,240),(R,G(R)),(683,G(683))],[
 ("a",88,[(683,205),(813,207),(R,240),(R,261),(683,257)]),
 ("b",94,[(683,257),(R,261),(R,307),(683,303)]),
 ("c",88,[(683,303),(R,307),(R,G(R)),(683,G(683))])])
lot(19,352,[(324,491),(331,477),(515,G(515)),(515,592),(324,592)])
lot(18,318,[(515,G(515)),(Dv(380),G(Dv(380))),(Dv(585),585),(515,585)],[
 ("a",145,[(515,G(515)),(Dv(380),G(Dv(380))),(Dv(483),483),(515,483)]),
 ("b",87,[(515,483),(Dv(483),483),(Dv(533),533),(515,533)]),
 ("c",86,[(515,533),(Dv(533),533),(Dv(585),585),(515,585)])])
lot(17,507,[(Dv(380),G(Dv(380))),(R,G(R)),(R,600),(Dv(597),597)],[
 ("a",165,[(Dv(380),G(Dv(380))),(R,G(R)),(R,440),(Dv(436),436)]),
 ("b",97,[(Dv(436),436),(R,440),(R,486),(Dv(484),484)]),
 ("c",104,[(Dv(484),484),(R,486),(R,535),(Dv(533),533)]),
 ("d",141,[(Dv(533),533),(R,535),(R,600),(Dv(597),597)])])
lot(15,340,[(515,585),(Dv(585),585),(665,D(665)),(515,D(515))],[
 ("a",84,[(515,585),(Dv(585),585),(Dv(630),630),(515,630)]),
 ("b",84,[(515,630),(Dv(630),630),(Dv(680),680),(515,680)]),
 ("c",83,[(515,680),(Dv(680),680),(Dv(730),730),(515,730)]),
 ("d",89,[(515,730),(Dv(730),730),(665,D(665)),(515,D(515))])])
lot(16,458,[(Dv(597),597),(R,600),(R,D(R)),(665,D(665))])
lot(14,451,[(324,592),(515,592),(515,D(515)),(324,D(324))])
lot(13,383,[(Lx(589),589),(255,589),(255,668),(324,668),(324,D(324)),(Lx(761),761)],[
 ("a",190,[(Lx(589),589),(174,589),*riv13,(243,D(243)),(Lx(761),761)]),
 ("b",193,[(174,589),(255,589),(255,668),(324,668),(324,D(324)),(243,D(243)),*riv13[::-1]])])
lot(12,293,[(Lx(761),761),(241,D(241)),(258,803),(273.7,925),(123,925)])
lot(11,264,[(241,D(241)),(402,D(402)),(402,925),(273.7,925),(258,803)])
lot(10,98,[(402,D(402)),(500.5,925),(402,925)])
lot(9,187,[(402,D(402)),(501,D(501)),(598,925),(500.5,925)])
lot(8,209,[(501,D(501)),(666,D(666)),(V(925),925),(598,925)])
lot(7,344,[(666,D(666)),(R,D(R)),(R,927),(V(925),925)])
riv23=[(313,939),(338,994),(373,1054)]
lot(1,311,[(123,925),(273.7,925),(282,1007),(240,1083),(122,1083)])
lot(2,180,[(273.7,925),(308,925),*riv23,(423,1085),(240,1083),(282,1007)])
lot(3,240,[(308,925),(401,926),(543,1086),(423,1085),*riv23[::-1]])
lot(4,171,[(401,926),(500.5,925),(607,1087),(543,1086)])
lot(5,218,[(500.5,925),(V(925),925),(656,1087),(607,1087)])
lot(6,425,[(V(925),925),(R,927),(R,1088),(656,1087)])
lots.sort(key=lambda l:l["num"])
outline=P((130,195),(813,207),(R,240),(R,1088),(122,1083))
rivers=[P((121,557),(143,569),(174,589),*riv13,(243,D(243)),(261,814),(293,874),(308,925),*riv23,(423,1085)),
        P((121,682),(180,724),(243,D(243))),
        P((130,262),(130,474)),
        P((Dv(578),580),(720,586),(760,586),(800,574),(R,553)),
        P((583,795),(700,798),(783,806),(820,800),(R,783)),
        P((672,646),(700,622))]
lagoons=[{"c":[843-OX,300-OY],"r":[13,19]},{"c":[781-OX,578-OY],"r":[17,9]},{"c":[296-OX,842-OY],"r":[26,15]},{"c":[848-OX,783-OY],"r":[12,13]}]
monte=[P((773,742),(812,742),(823,754),(860,764),(860,785),(783,806),(797,781),(790,760))]
def area(p):
    return abs(sum(p[i][0]*p[i-1][1]-p[i-1][0]*p[i][1] for i in range(len(p)))/2)
tot_px=sum(area(l["poly"]) for l in lots); tot_ha=sum(l["ha"] for l in lots)
k=tot_px/tot_ha; print("px/ha",round(k,1),"total ha",tot_ha)
for l in lots:
    r=area(l["poly"])/k/l["ha"]; flag="" if 0.85<r<1.15 else "  <--"
    print(l["num"],l["ha"],round(r,2),flag, [ (s["id"],round(area(s["poly"])/k/s["ha"],2)) for s in l["subs"]])
geo={"points":[
 {"key":"NO","label":"Esquina NO (lote 21)","map":outline[0],"lat":None,"lng":None,"acc":None,"at":None},
 {"key":"NE","label":"Esquina NE (lote 24, ochava)","map":outline[2],"lat":None,"lng":None,"acc":None,"at":None},
 {"key":"SE","label":"Esquina SE (lote 6)","map":outline[3],"lat":None,"lng":None,"acc":None,"at":None},
 {"key":"SO","label":"Esquina SO (lote 1)","map":outline[4],"lat":None,"lng":None,"acc":None,"at":None}]}
anchors=[{"key":"NO","label":"Esquina NO (lote 21)","map":outline[0]},{"key":"NE1","label":"Inicio ochava NE (lote 24)","map":outline[1]},
 {"key":"NE","label":"Esquina NE (lote 24, ochava)","map":outline[2]},{"key":"SE","label":"Esquina SE (lote 6)","map":outline[3]},
 {"key":"SO","label":"Esquina SO (lote 1)","map":outline[4]}]
json.dump({"lots":lots,"outline":outline,"decor":{"rivers":rivers,"lagoons":lagoons,"monte":monte},"georef":geo,"anchors":anchors,"pxPerHa":round(k,3)},open("tools/geometry.json","w"),ensure_ascii=False)

# label points: pole of inaccessibility via grid search
import math
def inside(p,poly):
    x,y=p; c=False; n=len(poly)
    for i in range(n):
        x1,y1=poly[i]; x2,y2=poly[i-1]
        if (y1>y)!=(y2>y) and x < (x2-x1)*(y-y1)/(y2-y1)+x1: c=not c
    return c
def segd(p,a,b):
    ax,ay=a; bx,by=b; px,py=p; dx,dy=bx-ax,by-ay; L=dx*dx+dy*dy
    t=0 if L==0 else max(0,min(1,((px-ax)*dx+(py-ay)*dy)/L))
    return math.hypot(px-ax-t*dx,py-ay-t*dy)
def pole(poly):
    xs=[p[0] for p in poly]; ys=[p[1] for p in poly]; best=None
    for i in range(60):
        for j in range(60):
            p=(min(xs)+(max(xs)-min(xs))*(i+.5)/60, min(ys)+(max(ys)-min(ys))*(j+.5)/60)
            if not inside(p,poly): continue
            d=min(segd(p,poly[k],poly[k-1]) for k in range(len(poly)))
            if best is None or d>best[0]: best=(d,p)
    return [round(best[1][0],1),round(best[1][1],1)]
g=json.load(open("tools/geometry.json"))
for l in g["lots"]:
    l["label"]=pole(l["poly"])
    for s in l["subs"]: s["label"]=pole(s["poly"])
json.dump(g,open("tools/geometry.json","w"),ensure_ascii=False)
print("labels ok")
