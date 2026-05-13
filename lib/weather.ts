interface OpenMeteoCurrent {
  temperature_2m?: number;
  weather_code?: number;
  is_day?: number;
}

interface OpenMeteoResponse {
  current?: OpenMeteoCurrent;
}

interface IpApiResponse {
  latitude?: number;
  longitude?: number;
  city?: string;
  region?: string;
  country_name?: string;
}

interface IpWhoResponse {
  success?: boolean;
  latitude?: number;
  longitude?: number;
  city?: string;
  region?: string;
  country?: string;
}

export interface WeatherContext {
  summary: string;
  source: "geolocation" | "ip" | "fallback";
  locationLabel?: string;
  latitude?: number;
  longitude?: number;
}

const WEATHER_LABELS: Record<number, string> = {
  0: "clear",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "foggy",
  48: "misty",
  51: "light drizzle",
  53: "drizzle",
  55: "steady drizzle",
  56: "freezing drizzle",
  57: "dense freezing drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  66: "freezing rain",
  67: "heavy freezing rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  77: "snow grains",
  80: "rain showers",
  81: "strong rain showers",
  82: "violent rain showers",
  85: "snow showers",
  86: "heavy snow showers",
  95: "a thunderstorm",
  96: "a thunderstorm with hail",
  99: "an intense thunderstorm with hail"
};

function formatTemperature(value: number) {
  return `${Math.round(value)}°C`;
}

function weatherLabel(code?: number) {
  if (code === undefined) {
    return null;
  }

  return WEATHER_LABELS[code] ?? "unusual weather";
}

function compactLocationLabel(parts: Array<string | undefined>) {
  return parts
    .filter(Boolean)
    .map((part) => part?.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
}

function buildWeatherSentence(
  temperature: number,
  weatherCode: number | undefined,
  isDay: number | undefined,
  locationLabel?: string
) {
  const label = weatherLabel(weatherCode) ?? "quiet weather";
  const temperatureLabel = formatTemperature(temperature);
  const timeTone = isDay === 0 ? "tonight" : "right now";
  const locationTone = locationLabel ? `Around ${locationLabel}` : "Around you";

  return `${locationTone}, it feels ${label} ${timeTone}, with the air sitting near ${temperatureLabel}.`;
}

export function buildWeatherFallbackLine() {
  return "I could not pin down your local weather yet, so I am staying with the mood already hanging in the room.";
}

async function fetchOpenMeteoWeather(latitude: number, longitude: number, locationLabel?: string): Promise<WeatherContext | null> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,weather_code,is_day");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as OpenMeteoResponse;
    const current = payload.current;

    if (!current || typeof current.temperature_2m !== "number") {
      return null;
    }

    return {
      summary: buildWeatherSentence(current.temperature_2m, current.weather_code, current.is_day, locationLabel),
      source: "geolocation",
      locationLabel,
      latitude,
      longitude
    };
  } catch {
    return null;
  }
}

async function lookupIpLocation(): Promise<Pick<WeatherContext, "latitude" | "longitude" | "locationLabel" | "source"> | null> {
  try {
    const response = await fetch("https://ipapi.co/json/", {
      headers: {
        Accept: "application/json"
      },
      cache: "no-store"
    });

    if (response.ok) {
      const payload = (await response.json()) as IpApiResponse;
      if (typeof payload.latitude === "number" && typeof payload.longitude === "number") {
        return {
          latitude: payload.latitude,
          longitude: payload.longitude,
          locationLabel: compactLocationLabel([payload.city, payload.region, payload.country_name]),
          source: "ip"
        };
      }
    }
  } catch {}

  try {
    const response = await fetch("https://ipwho.is/", {
      headers: {
        Accept: "application/json"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as IpWhoResponse;
    if (payload.success === false) {
      return null;
    }

    if (typeof payload.latitude === "number" && typeof payload.longitude === "number") {
      return {
        latitude: payload.latitude,
        longitude: payload.longitude,
        locationLabel: compactLocationLabel([payload.city, payload.region, payload.country]),
        source: "ip"
      };
    }
  } catch {}

  return null;
}

export async function fetchWeatherContext(latitude?: number, longitude?: number): Promise<WeatherContext> {
  if (typeof latitude === "number" && typeof longitude === "number") {
    const direct = await fetchOpenMeteoWeather(latitude, longitude, "your shared location");
    if (direct) {
      return direct;
    }
  }

  const ipLocation = await lookupIpLocation();
  if (ipLocation?.latitude !== undefined && ipLocation.longitude !== undefined) {
    const weather = await fetchOpenMeteoWeather(ipLocation.latitude, ipLocation.longitude, ipLocation.locationLabel);
    if (weather) {
      return {
        ...weather,
        source: "ip",
        locationLabel: ipLocation.locationLabel
      };
    }
  }

  return {
    summary: buildWeatherFallbackLine(),
    source: "fallback"
  };
}
