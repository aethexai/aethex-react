// Self-contained CSS for AethexVoiceOrb, injected once into <head> on the
// client. Scoped under `.aethex-orb`, driven by CSS custom properties so colors
// / border / font are overridable from props or CSS. The whole capsule is a
// single button (the orb is just its visual); it hugs its content
// (`width:max-content`) so it extends to the right as the status text grows.

export const ORB_STYLE_ID = "aethex-orb-styles"

export const ORB_CSS = `
.aethex-orb{
  --aethex-accent:#7C6CFF; --aethex-accent-2:#34E3C4;
  --aethex-c-line:#E4E7F0; --aethex-danger:#F0566B;
  --aethex-surface:rgba(255,255,255,0.86); --aethex-ink:#1A1D27; --aethex-dim:#697086;
  --aethex-orb-size:48px;
  appearance:none; -webkit-appearance:none; text-align:left;
  display:inline-flex; align-items:center; gap:11px; width:max-content; max-width:100%;
  padding:8px 18px 8px 8px; border:1px solid var(--aethex-c-line); border-radius:999px;
  background:var(--aethex-surface); -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px);
  box-shadow:0 1px 2px rgba(20,22,40,.04), 0 14px 34px -24px rgba(40,40,90,.45);
  color:var(--aethex-ink); box-sizing:border-box; cursor:pointer;
  /* Inherits the host app's font by default; override with the \`font\` prop. */
  font-family:var(--aethex-font, inherit);
  transition:box-shadow .25s ease, border-color .25s ease, transform .12s ease;
}
.aethex-orb *{box-sizing:border-box;}
.aethex-orb:hover{box-shadow:0 1px 2px rgba(20,22,40,.05), 0 18px 40px -22px rgba(40,40,90,.5);}
.aethex-orb:hover .aethex-orb__orb{transform:scale(1.06);}
.aethex-orb:active{transform:translateY(0.5px);}
.aethex-orb:focus-visible{outline:2px solid var(--aethex-accent); outline-offset:3px;}
.aethex-orb[data-theme="dark"]{
  --aethex-surface:#12141d; --aethex-c-line:#2A2E3A; --aethex-ink:#EDEEF4; --aethex-dim:#9097AC;
}
/* size: md is the base; sm / lg adjust the orb, padding, gap and text. */
.aethex-orb[data-size="sm"]{--aethex-orb-size:38px; gap:9px; padding:6px 14px 6px 6px;}
.aethex-orb[data-size="sm"] .aethex-orb__label{font-size:13px;}
.aethex-orb[data-size="sm"] .aethex-orb__sub{font-size:11px;}
.aethex-orb[data-size="lg"]{--aethex-orb-size:60px; gap:14px; padding:10px 24px 10px 10px;}
.aethex-orb[data-size="lg"] .aethex-orb__label{font-size:16px;}
.aethex-orb[data-size="lg"] .aethex-orb__sub{font-size:13px;}
/* floating mode (position/z-index come from inline style): lift it off the page
   with a stronger shadow. Round FABs (orb-only) carry the shadow on the orb. */
.aethex-orb[data-float]{box-shadow:0 6px 16px rgba(20,22,40,.12), 0 22px 48px -20px rgba(40,40,90,.55);}
.aethex-orb[data-float][data-orb-only="true"]{box-shadow:none;}
.aethex-orb[data-float][data-orb-only="true"] .aethex-orb__orb{box-shadow:0 10px 26px -8px rgba(20,22,40,.5);}
/* orb-only mode (no title): strip the capsule chrome, leaving just the orb. */
.aethex-orb[data-orb-only="true"]{
  padding:0; gap:0; border:0; background:transparent; box-shadow:none;
  -webkit-backdrop-filter:none; backdrop-filter:none; border-radius:50%;
}
.aethex-orb__orb{
  flex:none; width:var(--aethex-orb-size); height:var(--aethex-orb-size); border-radius:50%;
  display:block; overflow:hidden; transition:transform .2s ease;
}
.aethex-orb__orb canvas{width:100%; height:100%; display:block;}
/* Video orb: fill the circle; the clip is masked by the round slot. */
.aethex-orb__orb video{width:100%; height:100%; display:block; object-fit:cover; border-radius:50%;}
.aethex-orb__body{display:flex; flex-direction:column; min-width:0; padding-right:2px;}
.aethex-orb__label{
  margin:0; font-size:14px; font-weight:600; letter-spacing:-.01em; white-space:nowrap;
  display:flex; align-items:center; gap:7px;
}
.aethex-orb__time{color:var(--aethex-dim); font-weight:500; font-variant-numeric:tabular-nums;}
.aethex-orb__sub{margin:2px 0 0; font-size:12px; color:var(--aethex-dim); white-space:nowrap; font-weight:400;}
@media (prefers-reduced-motion: reduce){
  .aethex-orb, .aethex-orb__orb{transition:none;}
}
`
