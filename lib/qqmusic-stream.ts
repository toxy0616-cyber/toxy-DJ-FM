import { readPlayableLibrary } from "@/lib/music-library";

interface QqMidUrlResponse {
  req_1?: {
    data?: {
      midurlinfo?: Array<{
        purl?: string;
      }>;
      sip?: string[];
    };
  };
}

function qqHeaders(cookie: string) {
  return {
    Referer: "https://y.qq.com/",
    Origin: "https://y.qq.com",
    Cookie: cookie,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "Content-Type": "application/json"
  };
}

async function getPlayableTrack(trackId: string) {
  const library = await readPlayableLibrary();
  if (!library) {
    return null;
  }

  const track = library.tracks.find((item) => item.providerTrackId === trackId);
  if (!track) {
    return null;
  }

  return {
    track,
    sessionCookie: library.sessionCookie
  };
}

export async function resolveQqStreamUrl(trackId: string) {
  const playable = await getPlayableTrack(trackId);
  if (!playable) {
    throw new Error("Track not found in local QQ music library.");
  }

  if (!playable.sessionCookie) {
    throw new Error("QQ Music session cookie is missing. Please sync again.");
  }

  const songmid = playable.track.sourceMid ?? playable.track.providerTrackId;
  const response = await fetch("https://u.y.qq.com/cgi-bin/musicu.fcg", {
    method: "POST",
    headers: qqHeaders(playable.sessionCookie),
    body: JSON.stringify({
      req_1: {
        module: "vkey.GetVkeyServer",
        method: "CgiGetVkey",
        param: {
          guid: "1234567890",
          songmid: [songmid],
          songtype: [0],
          uin: "0",
          loginflag: 1,
          platform: "20"
        }
      },
      comm: {
        uin: "0",
        format: "json",
        ct: 24,
        cv: 0
      }
    })
  });

  if (!response.ok) {
    throw new Error(`QQ stream resolution failed with ${response.status}.`);
  }

  const payload = (await response.json()) as QqMidUrlResponse;
  const purl = payload.req_1?.data?.midurlinfo?.[0]?.purl;
  const sip = payload.req_1?.data?.sip?.[0];

  if (!purl || !sip) {
    throw new Error("QQ Music did not return a playable stream URL. Please resync your library.");
  }

  return {
    url: new URL(purl, sip).toString(),
    sessionCookie: playable.sessionCookie
  };
}
