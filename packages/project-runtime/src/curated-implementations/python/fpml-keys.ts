// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { FpmlHashLayout, FpmlKeyRecipe } from '../fpml-keys.js';

export function fpmlKey(recipe: FpmlKeyRecipe, layout: FpmlHashLayout) {
  return {
    call: true,
    dependencies: ['datetime', 'decimal', 'json', 're', 'zoneinfo'],
    expression:
      '(lambda prefix, ' +
      (recipe.includeId ? 'identifier, ' : '') +
      'value: ' +
      '_rune_fpml_key(prefix, value, ' +
      JSON.stringify(recipe.type) +
      ', ' +
      [
        recipe.missing,
        recipe.modulus,
        recipe.includePrefix ? 'True' : 'False',
        recipe.includeId ? 'identifier' : 'None',
        recipe.includeId ? 'True' : 'False'
      ].join(', ') +
      '))',
    moduleSource: fpmlHashSource.replace('# hash layout', () => JSON.stringify(JSON.stringify(layout)))
  };
}

const fpmlHashSource = String.raw`import json as _rune_fpml_json
from datetime import datetime as _rune_fpml_datetime, time as _rune_fpml_time, timedelta as _rune_fpml_delta, timezone as _rune_fpml_timezone
from decimal import Decimal as _rune_fpml_decimal
from zoneinfo import ZoneInfo as _rune_fpml_zone

_rune_fpml_layout = _rune_fpml_json.loads(
    # hash layout
)


def _rune_fpml_int32(value):
    return (value + 2147483648) % 4294967296 - 2147483648


def _rune_fpml_mix(seed, value):
    return _rune_fpml_int32(31 * seed + value)


def _rune_fpml_string(value):
    if not isinstance(value, str):
        raise TypeError('Expected an FpML string')
    data = value.encode('utf-16-be', errors='surrogatepass')
    result = 0
    for index in range(0, len(data), 2):
        result = _rune_fpml_mix(result, (data[index] << 8) | data[index + 1])
    return result


def _rune_fpml_decimal_hash(value, token):
    if isinstance(value, bool) or not isinstance(value, (int, float, _rune_fpml_decimal)):
        raise TypeError('Expected a finite FpML decimal')
    use_token = isinstance(token, str) and re.fullmatch(r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?', token) and float(token) == value
    if use_token:
        decimal = _rune_fpml_decimal(token)
    else:
        decimal = value if isinstance(value, _rune_fpml_decimal) else _rune_fpml_decimal(str(value))
    if not decimal.is_finite():
        raise TypeError('Expected a finite FpML decimal')
    negative, digits, exponent = decimal.as_tuple()
    if isinstance(value, float) and not use_token:
        while len(digits) > 1 and digits[-1] == 0:
            digits = digits[:-1]
            exponent += 1
        # Match the ordinary JS number spelling when a wire token was not supplied.
        adjusted = len(digits) + exponent - 1
        if -6 <= adjusted <= 20 and exponent > 0:
            digits = (*digits, *((0,) * exponent))
            exponent = 0
    scale = -exponent
    if not -2147483648 <= scale <= 2147483647:
        raise ValueError('FpML decimal scale exceeds Java BigDecimal')
    coefficient = 0
    for digit in digits:
        coefficient = 10 * coefficient + digit
    hex_digits = format(coefficient, 'x')
    end = len(hex_digits) % 8 or 8
    result = int(hex_digits[:end], 16)
    for start in range(end, len(hex_digits), 8):
        result = _rune_fpml_mix(result, int(hex_digits[start:start + 8], 16))
    return _rune_fpml_mix(-result if negative else result, scale)


def _rune_fpml_clock(value, text):
    fraction = re.search(r'\.([0-9]{1,9})', text)
    tail = int(fraction[1].ljust(9, '0')[6:]) if fraction else 0
    seconds = value.hour * 3600 + value.minute * 60 + value.second
    nanos = seconds * 1000000000 + value.microsecond * 1000 + tail
    return _rune_fpml_int32(nanos ^ (nanos >> 32))


def _rune_fpml_offset(text):
    if text == 'Z':
        return 0
    hours, minutes, *seconds = map(int, text[1:].split(':'))
    second = seconds[0] if seconds else 0
    if hours > 18 or minutes > 59 or second > 59 or (hours == 18 and (minutes or second)):
        raise ValueError('Invalid FpML timezone offset: ' + text)
    return (-1 if text[0] == '-' else 1) * (hours * 3600 + minutes * 60 + second)


def _rune_fpml_timestamp(value):
    if isinstance(value, _rune_fpml_datetime):
        name = getattr(value.tzinfo, 'key', None)
        value = value.isoformat() + ('[' + name + ']' if name else '')
    match = re.fullmatch(r'(.*?)(Z|[+-][0-9]{2}:[0-9]{2}(?::[0-9]{2})?)(?:\[([^\]]+)\])?', value)
    if not match:
        raise ValueError('Expected an FpML timestamp with an offset')
    local, offset, zone = match.groups()
    source_offset = _rune_fpml_offset(offset)
    parsed = _rune_fpml_datetime.fromisoformat(local)
    fixed = re.fullmatch(r'(UTC|GMT|UT)?(Z|[+-][0-9]{2}:[0-9]{2}(?::[0-9]{2})?)', zone) if zone else None
    if zone is None or fixed:
        resolved_offset = _rune_fpml_offset(fixed[2]) if fixed else source_offset
        parsed += _rune_fpml_delta(seconds=resolved_offset - source_offset)
        zone_hash = _rune_fpml_string(fixed[1] + (fixed[2] if resolved_offset else '')) if fixed and fixed[1] else resolved_offset
    else:
        parsed = parsed.replace(tzinfo=_rune_fpml_timezone(_rune_fpml_delta(seconds=source_offset)))
        parsed = parsed.astimezone(_rune_fpml_zone('UTC' if zone == 'UT' else zone))
        resolved_offset = int(parsed.utcoffset().total_seconds())
        zone_hash = _rune_fpml_string(zone)
    date_hash = (parsed.year & 0xfffff800) ^ ((parsed.year << 11) + (parsed.month << 6) + parsed.day)
    zone_hash &= 0xffffffff
    return _rune_fpml_int32(date_hash ^ _rune_fpml_clock(parsed, local) ^ resolved_offset ^ ((zone_hash << 3) | (zone_hash >> 29)))


def _rune_fpml_hash(value, declared, token=None):
    if value is None:
        return 0
    match declared:
        case 'java.lang.String':
            return _rune_fpml_string(value)
        case 'java.lang.Boolean':
            if not isinstance(value, bool):
                raise TypeError('Expected an FpML boolean')
            return 1231 if value else 1237
        case 'java.lang.Integer':
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not -2147483648 <= value <= 2147483647 or value != int(value):
                raise TypeError('Expected an FpML 32-bit integer')
            return int(value)
        case 'java.math.BigDecimal':
            return _rune_fpml_decimal_hash(value, token)
        case 'java.time.LocalTime':
            return _rune_fpml_clock(_rune_fpml_time.fromisoformat(value), value) if isinstance(value, str) else _rune_fpml_clock(value, '')
        case 'java.time.ZonedDateTime':
            return _rune_fpml_timestamp(value)
    if not isinstance(value, dict):
        raise TypeError('Expected an FpML object')
    actual = value.get('@type', declared)
    ancestor = actual
    while ancestor in _rune_fpml_layout and ancestor != declared:
        ancestor = _rune_fpml_layout[ancestor][0]
    if ancestor != declared:
        raise TypeError(str(actual) + ' does not extend ' + declared)
    return _rune_fpml_fields(value, actual)


def _rune_fpml_fields(value, declared):
    parent, fields = _rune_fpml_layout[declared]
    result = _rune_fpml_fields(value, parent) if parent else 0
    tokens = value.get('@numberText')
    for key, kind, flags in fields:
        child = value.get(key)
        token = tokens.get(key) if isinstance(tokens, dict) else None
        contribution = 0
        if child is not None:
            if flags & 1:
                items = child if isinstance(child, list) else [child]
                if items:
                    if flags & 2:
                        contribution = _rune_fpml_int32(len(items) * _rune_fpml_string(kind))
                    else:
                        contribution = 1
                        for index, item in enumerate(items):
                            item_token = token.get(str(index)) if isinstance(token, dict) else token
                            contribution = _rune_fpml_mix(contribution, _rune_fpml_hash(item, kind, item_token))
            else:
                contribution = _rune_fpml_string(kind) if flags & 2 else _rune_fpml_hash(child, kind, token)
        result = _rune_fpml_mix(result, contribution)
    return result


def _rune_fpml_key(prefix, value, kind, missing, modulus, include_prefix, identifier, include_id):
    if not isinstance(prefix, str):
        raise TypeError('FpML key prefix is required')
    result = missing if value is None else _rune_fpml_hash(value, kind)
    if include_prefix:
        result += _rune_fpml_string(prefix)
    if include_id:
        result += 3 if identifier is None else _rune_fpml_string(identifier)
    return prefix + '-$' + str(abs(_rune_fpml_int32(result)) % modulus)`;
