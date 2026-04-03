export interface LaunchStatus {
  id:    number;
  label: string;  // e.g. "Go", "TBD", "Success"
  color: string;  // hex
  desc:  string;
}

export interface LaunchPad {
  name:        string;
  lat:         number;
  lon:         number;
  country:     string;
  hasUpcoming: boolean;
}

export interface LaunchMission {
  name:  string;
  type:  string;
  orbit: string;
  desc:  string;
}

export interface Launch {
  id:           string;
  name:         string;
  net:          string | null;   // ISO 8601 — launch time (NET = No Earlier Than)
  window_start: string | null;
  window_end:   string | null;
  status:       LaunchStatus;
  provider:     string;
  providerType: string;
  rocket:       string;
  mission:      LaunchMission;
  pad:          LaunchPad;
  image:        string | null;
  webcastLive:  boolean;
  failreason:   string;
}

export interface SpaceEvent {
  id:          number;
  name:        string;
  date:        string | null;
  type:        string;
  location:    string;
  description: string;
  image:       string | null;
  webcastLive: boolean;
}

export interface LaunchData {
  launches:   Launch[];
  previous:   Launch[];
  events:     SpaceEvent[];
  pads:       LaunchPad[];
  lastUpdate: string | null;
  status:     string;
}
