import { ImageResponse } from "next/og";

export const size = {
  width: 512,
  height: 512
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 36,
          color: "#f5f7fb",
          background:
            "radial-gradient(circle at top, rgba(120,247,212,0.18), transparent 35%), linear-gradient(180deg, #08090e, #11161f)"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, letterSpacing: 8 }}>
          <span>TOXY</span>
          <span>FM</span>
        </div>
        <div style={{ fontSize: 164, lineHeight: 1, letterSpacing: 12 }}>24 7</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 28, color: "#78f7d4" }}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 99,
              background: "#78f7d4"
            }}
          />
          ON AIR
        </div>
      </div>
    ),
    size
  );
}

