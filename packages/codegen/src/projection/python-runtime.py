# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Pradeep Mouli

from __future__ import annotations

import math
import re
import calendar
from functools import reduce, cmp_to_key
from datetime import date, time, datetime, timedelta, timezone
from typing import Any, Callable, TypedDict, NotRequired
from zoneinfo import ZoneInfo


class RuneField[T](TypedDict):
    value: T
    meta: NotRequired[dict[str, Any]]


class RuneReference[T](TypedDict):
    value: NotRequired[T]
    externalReference: NotRequired[str]
    globalReference: NotRequired[str]
    reference: NotRequired[dict[str, Any]]
    meta: NotRequired[dict[str, Any]]


class _RuneMetadataValue(dict):
    pass


_rune_native_bindings = {}


def rune_bind(name, implementation):
    if not callable(implementation):
        raise TypeError("Native binding must be callable: " + name)
    _rune_native_bindings[name] = implementation


def rune_native(name, *args, _rune_fallback=None):
    implementation = _rune_native_bindings.get(name)
    if implementation is None:
        implementation = _rune_fallback
    if implementation is None:
        raise ValueError("Native binding required: " + name)
    return implementation(*args)


def rune_identity(value):
    return value


def rune_assignment_value(value, input_kind, target_kind, many):
    value = rune_list(value) if many else rune_single(value)
    if value is None or input_kind == target_kind:
        return value
    if target_kind == "value":
        return rune_unwrap(value, many)
    return rune_normalize_metadata(value, input_kind, target_kind)


def rune_normalize_object(value, fields):
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("Expected an object in function inputs")
    return {key: fields[key](item) if key in fields else item for key, item in value.items()}


def rune_is_metadata_input(value, shape):
    if not isinstance(value, dict) or not any(key in value for key in ("value", "reference", "externalReference", "globalReference")):
        return False
    if shape is None:
        return True
    if not all(key in ("value", "meta", "reference", "externalReference", "globalReference") for key in value):
        return False
    def matches(key, item):
        if key not in shape:
            return False
        if item is None:
            return True
        if shape[key] == "array":
            return isinstance(item, list)
        if shape[key] == "object":
            return isinstance(item, dict)
        return not isinstance(item, (dict, list))
    return not all(matches(key, item) for key, item in value.items())


def rune_normalize_attribute(value, kind, many, normalize, payload_shape):
    if value is None:
        return None
    if many and isinstance(value, list):
        return [rune_normalize_attribute(item, kind, False, normalize, payload_shape) for item in value]
    wrapped = kind != "value" and (isinstance(value, _RuneMetadataValue) or rune_is_metadata_input(value, payload_shape))
    if wrapped:
        result = _RuneMetadataValue(value)
        if result.get("value") is not None:
            result["value"] = normalize(result["value"])
        return result
    normalized = normalize(value)
    return _RuneMetadataValue(value=normalized) if kind != "value" else normalized


def rune_empty_object(kind):
    if kind == "field":
        return _RuneMetadataValue(meta={})
    return _RuneMetadataValue() if kind != "value" else {}


def rune_assign(root, segments, value, append, root_many, root_kind, lower, upper, label):
    if root is None:
        root = [] if root_many else rune_empty_object(root_kind)
    current, many, kind = root, root_many, root_kind
    for index, segment in enumerate(segments):
        if many:
            if not current:
                current.append(rune_empty_object(kind))
            current = current[0]
        metadata = segment.get("metadata")
        if metadata:
            names = metadata
        else:
            if kind != "value":
                if current.get("value") is None:
                    current["value"] = {}
                current = current["value"]
            names = [segment["name"]]
        for name in names[:-1]:
            if current.get(name) is None:
                current[name] = {}
            current = current[name]
        name = names[-1]
        if index == len(segments) - 1:
            combined = rune_list(current.get(name)) + rune_list(value) if append else value
            current[name] = rune_cardinality(combined, lower, upper, label)
        else:
            next_many, next_kind = segment["many"], segment["kind"]
            if current.get(name) is None:
                current[name] = [] if next_many else rune_empty_object(next_kind)
            current, many, kind = current[name], next_many, next_kind
    return root


def rune_exists(value):
    return value is not None and (not isinstance(value, list) or len(value) > 0)


def rune_default(value, fallback):
    return value if rune_exists(value) else fallback()


def rune_coalesce(values):
    return next((value for value in values if value is not None), None)


def rune_unwrap(value, many=False):
    if many or isinstance(value, list):
        return [item.get("value") for item in rune_list(value)
                if isinstance(item, dict) and item.get("value") is not None]
    return value.get("value") if isinstance(value, dict) else None


def rune_contains(left, right):
    l, r = rune_list(left), rune_list(right)
    keys = set(map(rune_value_key, l))
    return bool(l and r) and all(rune_value_key(item) in keys for item in r)


def rune_disjoint(left, right):
    keys = set(map(rune_value_key, rune_list(right)))
    return all(rune_value_key(item) not in keys for item in rune_list(left))


def rune_distinct(value, wrapped=False):
    seen, result = set(), []
    for item in rune_list(value):
        key = rune_value_key(rune_unwrap(item) if wrapped else item)
        if key not in seen:
            seen.add(key)
            result.append(item)
    return result


def rune_string_key(value):
    return value.encode("utf-16-be", "surrogatepass")


def rune_order(left, right, nulls_last=True):
    if left is None and right is None:
        return 0
    if left is None:
        return 1 if nulls_last else -1
    if right is None:
        return -1 if nulls_last else 1
    if isinstance(left, str) and isinstance(right, str):
        left, right = rune_string_key(left), rune_string_key(right)
    return -1 if left < right else 1 if left > right else 0


def rune_ordered(value, key, operation):
    pairs = [(item, key(item)) for item in rune_list(value)]
    if operation == "sort":
        return [item for item, _ in sorted(pairs, key=cmp_to_key(
            lambda a, b: rune_order(a[1], b[1])))]
    if not pairs:
        return None
    best = pairs[0]
    for pair in pairs[1:]:
        order = rune_order(pair[1], best[1], operation == "min")
        if (order < 0 if operation == "min" else order > 0):
            best = pair
    return best[0]


def rune_only(value):
    values = rune_list(value)
    return values[0] if len(values) == 1 else None


def rune_edge(value, last=False):
    values = rune_list(value)
    return values[-1 if last else 0] if values else None


def rune_reduce(value, reducer, normalize=lambda value: value):
    values = rune_list(value)
    return reduce(reducer, values[1:], normalize(values[0])) if values else None


def rune_number_string(value):
    value = float(value)
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"
    if value == 0:
        return "0"
    sign = "-" if value < 0 else ""
    # Both targets use IEEE-754 doubles and shortest round-trip decimal digits.
    # ECMAScript prints fixed notation for [1e-6, 1e21), unlike Python repr.
    mantissa, _, exponent = repr(abs(value)).partition("e")
    whole, _, fraction = mantissa.partition(".")
    raw = whole + fraction
    digits = raw.lstrip("0")
    position = len(whole) + int(exponent or "0") - (len(raw) - len(digits))
    digits = digits.rstrip("0")
    if 0 < position <= 21:
        text = (digits + "0" * (position - len(digits))) if position >= len(digits) else digits[:position] + "." + digits[position:]
    elif -6 < position <= 0:
        text = "0." + "0" * -position + digits
    else:
        power = position - 1
        text = digits[0] + ("." + digits[1:] if len(digits) > 1 else "") + "e" + ("+" if power >= 0 else "-") + str(abs(power))
    return sign + text


def rune_string(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return ",".join("" if item is None else rune_string(item) for item in value)
    if isinstance(value, dict):
        return "[object Object]"
    if isinstance(value, (int, float)):
        return rune_number_string(value)
    return str(value)


def rune_to_string(value):
    return None if value is None else rune_string(value)


def rune_number(value, integer=False):
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        value = rune_string(value)
    try:
        if isinstance(value, str):
            value = value.strip()
            if not value:
                result = 0.0
            elif re.fullmatch(r"0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+", value):
                result = float(int(value, 0))
            elif re.fullmatch(r"[+-]?(?:Infinity|(?:(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?))", value):
                result = float(value.replace("Infinity", "inf"))
            else:
                return None
        else:
            result = float(value)
        if math.isnan(result) or (integer and (not math.isfinite(result) or not result.is_integer())):
            return None
        if result == 0 and math.copysign(1, result) < 0:
            return result
        return int(result) if integer else result
    except (ValueError, TypeError, OverflowError):
        return None


def rune_temporal(value, kind):
    text = str(value)
    if kind == "date":
        return date.fromisoformat(text)
    if kind == "time":
        return time.fromisoformat(text)
    if kind == "zonedDateTime":
        base, _, zone = text.partition("[")
        parsed = datetime.fromisoformat(base.replace("Z", "+00:00"))
        if zone:
            name = zone.rstrip("]")
            target = ZoneInfo(name)
            if parsed.tzinfo:
                if base.endswith("Z"):
                    parsed = parsed.astimezone(target)
                else:
                    wall = parsed.replace(tzinfo=None)
                    supplied = int(parsed.utcoffset().total_seconds())
                    minute_precision = re.search(r"[+-]\d{2}:\d{2}$", base) is not None
                    candidates = [wall.replace(tzinfo=target, fold=fold).astimezone(timezone.utc).astimezone(target)
                                  for fold in (0, 1)]
                    parsed = next((candidate for candidate in candidates
                                   if candidate.replace(tzinfo=None) == wall and
                                   (int(candidate.utcoffset().total_seconds()) == supplied or
                                    (minute_precision and rune_offset_minutes(int(candidate.utcoffset().total_seconds())) * 60 == supplied))), None)
                    if parsed is None:
                        raise ValueError("Offset does not match timezone")
            else:
                parsed = parsed.replace(tzinfo=target).astimezone(timezone.utc).astimezone(target)
        if parsed.tzinfo is None:
            raise ValueError("zonedDateTime requires a timezone")
        return parsed
    return datetime.fromisoformat(text)


def rune_iso(value):
    if isinstance(value, (time, datetime)):
        text = value.isoformat(timespec="microseconds" if value.microsecond else "seconds")
        if value.microsecond:
            text = re.sub(r"(\.\d*?[1-9])0+(?=[+-]|$)", r"\1", text)
        return text
    return value.isoformat()


def rune_time_text(value, kind=None):
    text = str(value)
    if kind == "zonedDateTime":
        _, (hour, minute, second, nano), _ = rune_zoned_parts(text)
    else:
        hour, minute, second, nano = rune_clock_parts(text)
    digits = f"{nano:09d}".rstrip("0") if nano else ""
    return f"{hour:02d}:{minute:02d}:{second:02d}" + ("." + digits if digits else "")


def rune_clock_parts(value):
    match = re.search(r"(?:^|[Tt ])(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?", str(value))
    if not match:
        raise ValueError("Invalid ISO time")
    hour, minute, second = int(match[1]), int(match[2]), int(match[3] or 0)
    if hour > 23 or minute > 59 or second > 60:
        raise ValueError("Invalid ISO time")
    return hour, minute, min(second, 59), int((match[4] or "0").ljust(9, "0"))


def rune_calendar_parts(value):
    match = re.match(r"^([+-]?\d{4,6})-(\d{2})-(\d{2})", str(value))
    if not match:
        raise ValueError("Invalid ISO date")
    year, month, day = map(int, match.groups())
    if not 1 <= month <= 12 or not 1 <= day <= calendar.monthrange(year, month)[1]:
        raise ValueError("Invalid ISO date")
    return year, month, day


def rune_calendar_text(year, month, day):
    prefix = f"{year:04d}" if 0 <= year <= 9999 else ("-" if year < 0 else "+") + f"{abs(year):06d}"
    text = f"{prefix}-{month:02d}-{day:02d}"
    rune_calendar_parts(text)
    return text


def rune_date_days(value):
    # Gregorian eras avoid datetime's year-1 floor and retain astronomical year zero.
    year, month, day = rune_calendar_parts(value)
    year -= int(month <= 2)
    era = year // 400
    year_of_era = year - era * 400
    day_of_year = (153 * (month + (-3 if month > 2 else 9)) + 2) // 5 + day - 1
    return era * 146097 + year_of_era * 365 + year_of_era // 4 - year_of_era // 100 + day_of_year


def rune_calendar_from_days(days):
    era, day_of_era = divmod(days, 146097)
    year_of_era = (day_of_era - day_of_era // 1460 + day_of_era // 36524 - day_of_era // 146096) // 365
    year = year_of_era + era * 400
    day_of_year = day_of_era - (365 * year_of_era + year_of_era // 4 - year_of_era // 100)
    month_index = (5 * day_of_year + 2) // 153
    day = day_of_year - (153 * month_index + 2) // 5 + 1
    month = month_index + (3 if month_index < 10 else -9)
    return year + int(month <= 2), month, day


def rune_offset_seconds(text):
    if text == "Z" or text == "UTC":
        return 0
    match = re.fullmatch(r"([+-])(\d{2}):(\d{2})", text)
    if not match or int(match[2]) > 23 or int(match[3]) > 59:
        raise ValueError("Invalid timezone offset")
    return (1 if match[1] == "+" else -1) * (int(match[2]) * 3600 + int(match[3]) * 60)


def rune_offset_minutes(seconds):
    return (1 if seconds >= 0 else -1) * ((abs(seconds) + 30) // 60)


def rune_named_zoned_parts(base, zone):
    parts, clock = rune_calendar_parts(base), rune_clock_parts(base)
    year, month, day = parts
    # The Gregorian cycle preserves weekdays/leap days for TZif's prehistory and recurring future rules.
    proxy_year = 400 + year % 400 if year <= 1 else 2400 + year % 400 if year >= 9999 else year
    proxy = re.sub(r"^[+-]?\d{4,6}", f"{proxy_year:04d}", base)
    parsed = rune_temporal(proxy + "[" + zone + "]", "zonedDateTime")
    day_shift = (parsed.date() - date(proxy_year, month, day)).days
    parts = rune_calendar_from_days(rune_date_days(base) + day_shift)
    return parts, (parsed.hour, parsed.minute, parsed.second, clock[3]), int(parsed.utcoffset().total_seconds())


def rune_zoned_parts(value):
    text = str(value)
    base, _, annotation = text.partition("[")
    zone = annotation.rstrip("]")
    offset_match = re.search(r"(Z|[+-]\d{2}:\d{2})$", base)
    if zone == "UTC" or re.fullmatch(r"[+-]\d{2}:\d{2}", zone):
        offset = rune_offset_seconds(zone)
        supplied = offset_match[1] if offset_match else None
        if supplied and supplied != "Z" and rune_offset_seconds(supplied) != offset:
            raise ValueError("Offset does not match timezone")
    elif not zone and offset_match:
        supplied = offset_match[1]
        offset = rune_offset_seconds(supplied)
    else:
        return rune_named_zoned_parts(base, zone)
    parts, clock = rune_calendar_parts(base), rune_clock_parts(base)
    if supplied == "Z" and offset:
        day_shift, seconds = divmod(clock[0] * 3600 + clock[1] * 60 + clock[2] + offset, 86400)
        parts = rune_calendar_from_days(rune_date_days(base) + day_shift)
        hour, seconds = divmod(seconds, 3600)
        minute, second = divmod(seconds, 60)
        clock = hour, minute, second, clock[3]
    return parts, clock, offset


def rune_date_join(left, right):
    return rune_calendar_text(*rune_calendar_parts(left)) + "T" + rune_time_text(right)


def rune_temporal_key(value, kind):
    if kind == "date":
        return rune_date_days(value)
    clock = rune_clock_parts(value)
    if kind == "time":
        return clock
    if kind == "dateTime":
        return (rune_date_days(value), *clock)
    parts, clock, offset = rune_zoned_parts(value)
    seconds = rune_date_days(rune_calendar_text(*parts)) * 86400 + clock[0] * 3600 + clock[1] * 60 + clock[2] - offset
    return seconds * 1000000000 + clock[3]


def rune_convert_temporal(value, pattern):
    return value if isinstance(value, str) and re.fullmatch(pattern, value, re.ASCII) else None


def rune_date_field(value, kind, field):
    if value is None:
        return None
    parts = rune_zoned_parts(value)[0] if kind == "zonedDateTime" else rune_calendar_parts(value)
    if field in ("year", "month", "day"):
        return parts[("year", "month", "day").index(field)]
    if field == "date" and kind != "date":
        return rune_calendar_text(*parts)
    if field == "time" and kind != "date":
        return rune_time_text(value, kind)
    if field == "timezone":
        zone = str(value).partition("[")[2].rstrip("]")
        return zone or ("UTC" if str(value).endswith("Z") else str(value)[-6:])
    return None


def rune_date_construct(kind, fields):
    if kind == "date":
        if any(fields.get(name) is None for name in ("year", "month", "day")):
            return None
        return rune_calendar_text(int(fields["year"]), int(fields["month"]), int(fields["day"]))
    if fields.get("date") is None or fields.get("time") is None:
        return None
    combined = rune_date_join(fields["date"], fields["time"])
    if kind == "dateTime":
        return combined
    zone = fields.get("timezone")
    if zone is None:
        return None
    zone = "UTC" if zone == "Z" else zone
    if zone == "UTC" or re.fullmatch(r"[+-]\d{2}:\d{2}", zone):
        rune_offset_seconds(zone)
        return combined + ("+00:00" if zone == "UTC" else zone) + "[" + zone + "]"
    parts, clock, seconds = rune_named_zoned_parts(combined, zone)
    hour, minute, second, nano = clock
    combined = rune_calendar_text(*parts) + f"T{hour:02d}:{minute:02d}:{second:02d}"
    if nano:
        combined += "." + f"{nano:09d}".rstrip("0")
    minutes = rune_offset_minutes(seconds)
    offset = ("+" if minutes >= 0 else "-") + f"{abs(minutes) // 60:02d}:{abs(minutes) % 60:02d}"
    return combined + offset + "[" + zone + "]"


def rune_with_meta(value, entries, input_kind="value"):
    if not entries:
        return value
    if isinstance(value, list):
        return [wrapped for item in value for wrapped in [rune_with_meta(item, entries, input_kind)] if wrapped is not None]
    wrapper = value if input_kind != "value" and value is not None else None
    raw = wrapper.get("value") if wrapper is not None else value
    field_meta = {key: item for key, item in entries.items() if key not in ("key", "template", "address", "reference")}
    type_meta = {"externalKey" if key == "key" else key: entries[key] for key in ("key", "template") if key in entries}
    reference_meta = {key: entries[key] for key in ("address", "reference") if key in entries}
    if raw is None and not reference_meta:
        return None
    if type_meta and isinstance(raw, dict):
        raw = dict(raw, meta={**(raw.get("meta") or {}), **type_meta})
    if reference_meta:
        result = dict(wrapper, value=raw) if wrapper is not None else {"value": raw}
        if "address" in reference_meta:
            result["reference"] = {**((wrapper or {}).get("reference") or {}), "reference": reference_meta["address"]}
        if "reference" in reference_meta:
            result["externalReference"] = reference_meta["reference"]
        if field_meta:
            result["meta"] = {**((wrapper or {}).get("meta") or {}), **field_meta}
        return _RuneMetadataValue(result)
    if field_meta:
        return _RuneMetadataValue({**(wrapper or {}), "value": raw, "meta": {**((wrapper or {}).get("meta") or {}), **field_meta}})
    return _RuneMetadataValue(wrapper, value=raw) if wrapper is not None else raw


def rune_list(value):
    return [] if value is None else value if isinstance(value, list) else [value]


def rune_single(value):
    values = rune_list(value)
    if len(values) > 1:
        raise ValueError("Expected at most one value")
    return values[0] if values else None


def rune_binary(left, right, operate):
    left = [value for value in rune_list(left) if value is not None]
    right = [value for value in rune_list(right) if value is not None]
    return operate(left[0], right[0]) if len(left) == 1 and len(right) == 1 else None


def rune_compare(left, right, compare, quantifier="all"):
    left = [value for value in rune_list(left) if value is not None]
    right = [value for value in rune_list(right) if value is not None]
    if not left or not right:
        return False
    return (all if quantifier == "all" else any)(compare(a, b) for a in left for b in right)


def rune_value_key(value):
    if value is None:
        return ("null",)
    if isinstance(value, bool):
        return ("boolean", value)
    if isinstance(value, (int, float)):
        return ("number", "NaN" if math.isnan(value) else value)
    if isinstance(value, str):
        return ("string", rune_string_key(value))
    if isinstance(value, list):
        return ("array", tuple(rune_value_key(item) for item in value))
    return ("object", tuple((key, rune_value_key(value[key])) for key in sorted(value) if value[key] is not None))


def rune_divide(left, right):
    if right == 0:
        if left == 0:
            return math.nan
        return math.copysign(math.inf, left * math.copysign(1, right))
    return left / right


def rune_get(value, path, many=False):
    for name in path:
        if many:
            value = [child for item in rune_list(value)
                     for child in rune_list(item.get(name) if isinstance(item, dict) else None)]
        else:
            value = value.get(name) if isinstance(value, dict) else None
    return value


def rune_normalize_metadata(value, input_kind, target_kind):
    if isinstance(value, list):
        return [rune_normalize_metadata(item, input_kind, target_kind) for item in value]
    existing = value if input_kind != "value" and value is not None else None
    raw = existing.get("value") if existing is not None else value
    if target_kind == "reference":
        return _RuneMetadataValue(existing) if existing is not None else _RuneMetadataValue(value=raw)
    if input_kind == "reference" and raw is None:
        raise ValueError("Cannot convert reference metadata to field metadata without a value")
    return _RuneMetadataValue(value=raw, meta=existing.get("meta", {}) if existing is not None else {})


def rune_to_field(value, input_kind="value"):
    return rune_normalize_metadata(value, input_kind, "field")


def rune_to_reference(value, input_kind="value"):
    return rune_normalize_metadata(value, input_kind, "reference")


def rune_as_key(value, input_kind="value"):
    if isinstance(value, list):
        return [rune_as_key(item, input_kind) for item in value]
    candidate = value if isinstance(value, dict) else {}
    nested = candidate.get("value") if input_kind != "value" else None
    meta = nested.get("meta") if isinstance(nested, dict) else None
    if meta is None:
        meta = candidate.get("meta")
    if meta is None:
        meta = {}
    external = next((item for item in (meta.get("externalKey"), meta.get("id"), meta.get("key"), candidate.get("externalReference")) if item is not None), None)
    global_key = meta.get("globalKey")
    if global_key is None:
        global_key = candidate.get("globalReference")
    return _RuneMetadataValue({key: item for key, item in (("externalReference", external), ("globalReference", global_key)) if item is not None})


def rune_cardinality(value, lower, upper, label):
    many = upper is None or upper > 1
    value = rune_list(value) if many else rune_single(value)
    size = len(value) if many else int(value is not None)
    if size < lower:
        raise ValueError(label + (" has too few values" if many else " requires a value"))
    if upper is not None and size > upper:
        raise ValueError(label + " has too many values")
    return value


def rune_set(root, path, value, append, lower, upper, label):
    current = root
    for name in path[:-1]:
        existing = current.get(name)
        if existing is None:
            existing = {}
            current[name] = existing
        current = existing
    key = path[-1]
    combined = rune_list(current.get(key)) + rune_list(value) if append else value
    current[key] = rune_cardinality(combined, lower, upper, label)
    return root


class rune:
    @staticmethod
    def equals(left, right, quantifier=None, unequal=False):
        if quantifier is None:
            same = rune_value_key(left) == rune_value_key(right)
            return not same if unequal else same
        l, r = rune_list(left), rune_list(right)
        left_array, right_array = isinstance(left, list), isinstance(right, list)
        if not l or not r:
            same = left_array == right_array and len(l) == len(r)
            return not same if unequal else same
        compare = lambda a, b: not rune.equals(a, b) if unequal else rune.equals(a, b)
        predicate = all if quantifier == "all" else any
        if not left_array:
            return predicate(compare(left, b) for b in r)
        if not right_array:
            return predicate(compare(a, right) for a in l)
        if quantifier == "all":
            return (unequal or len(l) == len(r)) and all(
                (unequal if i >= len(r) else compare(a, r[i])) for i, a in enumerate(l))
        return (unequal and len(l) != len(r)) or any(compare(a, r[i]) for i, a in enumerate(l) if i < len(r))


    bind = staticmethod(rune_bind)
    native = staticmethod(rune_native)
    identity = staticmethod(rune_identity)
    assignmentValue = staticmethod(rune_assignment_value)
    normalizeObject = staticmethod(rune_normalize_object)
    normalizeAttribute = staticmethod(rune_normalize_attribute)
    assign = staticmethod(rune_assign)
    exists = staticmethod(rune_exists)
    default = staticmethod(rune_default)
    coalesce = staticmethod(rune_coalesce)
    unwrap = staticmethod(rune_unwrap)
    contains = staticmethod(rune_contains)
    disjoint = staticmethod(rune_disjoint)
    distinct = staticmethod(rune_distinct)
    stringKey = staticmethod(rune_string_key)
    order = staticmethod(rune_order)
    ordered = staticmethod(rune_ordered)
    only = staticmethod(rune_only)
    edge = staticmethod(rune_edge)
    reduce = staticmethod(rune_reduce)
    numberString = staticmethod(rune_number_string)
    string = staticmethod(rune_string)
    toString = staticmethod(rune_to_string)
    number = staticmethod(rune_number)
    temporal = staticmethod(rune_temporal)
    iso = staticmethod(rune_iso)
    timeText = staticmethod(rune_time_text)
    clockParts = staticmethod(rune_clock_parts)
    calendarParts = staticmethod(rune_calendar_parts)
    calendarText = staticmethod(rune_calendar_text)
    dateDays = staticmethod(rune_date_days)
    calendarFromDays = staticmethod(rune_calendar_from_days)
    offsetSeconds = staticmethod(rune_offset_seconds)
    zonedParts = staticmethod(rune_zoned_parts)
    dateJoin = staticmethod(rune_date_join)
    temporalKey = staticmethod(rune_temporal_key)
    convertTemporal = staticmethod(rune_convert_temporal)
    dateField = staticmethod(rune_date_field)
    dateConstruct = staticmethod(rune_date_construct)
    withMeta = staticmethod(rune_with_meta)
    list = staticmethod(rune_list)
    single = staticmethod(rune_single)
    binary = staticmethod(rune_binary)
    compare = staticmethod(rune_compare)
    valueKey = staticmethod(rune_value_key)
    divide = staticmethod(rune_divide)
    get = staticmethod(rune_get)
    normalizeMetadata = staticmethod(rune_normalize_metadata)
    toField = staticmethod(rune_to_field)
    toReference = staticmethod(rune_to_reference)
    asKey = staticmethod(rune_as_key)
    cardinality = staticmethod(rune_cardinality)
    set = staticmethod(rune_set)
