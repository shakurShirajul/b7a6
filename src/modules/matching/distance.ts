export type Coordinates = Readonly<{
  latitude: number;
  longitude: number;
}>;

export type BoundingBox = Readonly<{
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
  crossesAntimeridian: boolean;
}>;

export const EARTH_RADIUS_KM = 6_371.0088;

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;
const radiansToDegrees = (radians: number) => (radians * 180) / Math.PI;

const assertCoordinates = ({ latitude, longitude }: Coordinates) => {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new RangeError("Coordinates are outside their valid ranges");
  }
};

const normalizeLongitude = (longitude: number) => {
  const normalized = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
};

export const hasCompleteCoordinates = (
  latitude: unknown,
  longitude: unknown,
): boolean =>
  latitude !== null &&
  latitude !== undefined &&
  longitude !== null &&
  longitude !== undefined;

export const haversineDistanceKm = (
  from: Coordinates,
  to: Coordinates,
): number => {
  assertCoordinates(from);
  assertCoordinates(to);

  const latitudeDelta = degreesToRadians(to.latitude - from.latitude);
  const longitudeDelta = degreesToRadians(to.longitude - from.longitude);
  const fromLatitude = degreesToRadians(from.latitude);
  const toLatitude = degreesToRadians(to.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    2 *
    EARTH_RADIUS_KM *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)))
  );
};

export const calculateHaversineDistance = haversineDistanceKm;
export const haversineDistance = haversineDistanceKm;

export const calculateDistanceKm = (
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
) =>
  haversineDistanceKm(
    { latitude: fromLatitude, longitude: fromLongitude },
    { latitude: toLatitude, longitude: toLongitude },
  );

export const calculateDistance = calculateDistanceKm;

export const getBoundingBox = (
  center: Coordinates,
  radiusKm: number,
): BoundingBox => {
  assertCoordinates(center);
  if (!Number.isFinite(radiusKm) || radiusKm < 0) {
    throw new RangeError("Radius must be a finite non-negative number");
  }

  const angularRadius = radiusKm / EARTH_RADIUS_KM;
  const latitudeDelta = radiansToDegrees(angularRadius);
  const minLatitude = Math.max(-90, center.latitude - latitudeDelta);
  const maxLatitude = Math.min(90, center.latitude + latitudeDelta);
  const reachesPole = minLatitude === -90 || maxLatitude === 90;

  if (reachesPole) {
    return {
      minLatitude,
      maxLatitude,
      minLongitude: -180,
      maxLongitude: 180,
      crossesAntimeridian: false,
    };
  }

  const longitudeDelta = radiansToDegrees(
    Math.asin(
      Math.min(
        1,
        Math.sin(angularRadius) / Math.cos(degreesToRadians(center.latitude)),
      ),
    ),
  );
  const rawMinLongitude = center.longitude - longitudeDelta;
  const rawMaxLongitude = center.longitude + longitudeDelta;

  return {
    minLatitude,
    maxLatitude,
    minLongitude: normalizeLongitude(rawMinLongitude),
    maxLongitude: normalizeLongitude(rawMaxLongitude),
    crossesAntimeridian: rawMinLongitude < -180 || rawMaxLongitude > 180,
  };
};

export const calculateBoundingBox = (
  latitude: number,
  longitude: number,
  radiusKm: number,
) => getBoundingBox({ latitude, longitude }, radiusKm);
