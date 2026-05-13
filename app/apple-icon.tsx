import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(180deg, #08090e, #101722)",
          color: "#f5f7fb",
          fontSize: 64,
          letterSpacing: 10
        }}
      >
        TOXY
      </div>
    ),
    size
  );
}
