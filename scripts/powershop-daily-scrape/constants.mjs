/**
 * Defaults, timeouts and the Powershop measurements GraphQL query.
 *
 * Moved verbatim from `scripts/powershop-daily-scrape.mjs`, which stays the
 * entry point (`node /app/scripts/powershop-daily-scrape.mjs`).
 */

import path from "node:path";

export const DEFAULT_TEMPLATE_PATH = path.resolve("config", "powershop-usage-template.json");
export const DEFAULT_DATA_DIR = path.resolve("data", "power", "powershop");
export const DEFAULT_TIME_ZONE = "Pacific/Auckland";
export const DEFAULT_LOGIN_CODE_TIMEOUT_MS = 10 * 60 * 1000;
export const LOGIN_CODE_POLL_MS = 1000;
export const LOGIN_TIMEOUT_MS = 90_000;
export const PAGE_TIMEOUT_MS = 60_000;
/** How long the dashboard shell gets to paint before we call the session dead. */
export const AUTH_SETTLE_TIMEOUT_MS = 30_000;
export const MEASUREMENTS_LOOKBACK_HOURS = 72;
export const MEASUREMENT_COST_TYPES = new Set(["CONSUMPTION_COST", "STANDING_CHARGE_COST"]);

export const POWERSHOP_MEASUREMENTS_QUERY = `
  fragment MeasurementFields on MeasurementConnection {
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
    edges {
      node {
        source
        value
        unit
        readAt
        ... on IntervalMeasurementType {
          startAt
          endAt
        }
        metaData {
          utilityFilters {
            ... on ElectricityFiltersOutput {
              readingFrequencyType
              readingDirection
              registerId
              deviceId
              marketSupplyPointId
              readingQuality
            }
          }
          statistics {
            label
            type
            value
            costInclTax {
              estimatedAmount
            }
          }
        }
      }
    }
  }

  query measurements(
    $accountNumber: String!
    $propertyId: ID!
    $before: String
    $after: String
    $first: Int
    $last: Int
    $endOn: Date
    $readingFrequencyType: ReadingFrequencyType!
    $readingDirectionType: ReadingDirectionType
    $readingQualityType: ReadingQualityType
    $registerId: String
    $deviceId: String
    $marketSupplyPointId: String
  ) {
    account(accountNumber: $accountNumber) {
      id
      property(id: $propertyId) {
        id
        measurements(
          before: $before
          after: $after
          first: $first
          last: $last
          endOn: $endOn
          timezone: "Pacific/Auckland"
          utilityFilters: [
            {
              electricityFilters: {
                readingDirection: $readingDirectionType
                readingQuality: $readingQualityType
                readingFrequencyType: $readingFrequencyType
                registerId: $registerId
                deviceId: $deviceId
                marketSupplyPointId: $marketSupplyPointId
              }
            }
          ]
        ) {
          ... on MeasurementConnection {
            ...MeasurementFields
          }
        }
      }
    }
  }
`;
