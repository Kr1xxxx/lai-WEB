(function (root) {
  "use strict";
  const regions = [
    [
      "亚洲(Asia)",
      "CN HK MO TW JP KR KP IN ID MY SG TH VN PH BD PK LK NP BT MM LA KH BN TL AF IR IQ IL JO LB SY SA AE QA BH KW OM YE KZ KG UZ TJ TM MN AM AZ GE",
    ],
    [
      "北美洲(North America)",
      "US CA MX PA CR GT BZ HN SV NI CU DO HT JM TT BS BB GD LC VC AG KN DM",
    ],
    ["南美洲(South America)", "BR AR CL PE CO VE EC BO PY UY GY SR GF"],
    [
      "欧洲(Europe)",
      "GB IE FR DE ES PT IT NL BE LU CH AT PL CZ SK HU RO BG GR CY MT SI HR RS BA ME MK AL XK EE LV LT FI SE NO DK IS UA BY MD RU VA SM LI MC AD",
    ],
    [
      "非洲(Africa)",
      "ZA NG EG KE GH MA DZ TN LY SD SS ET UG TZ RW BI CD CG AO MZ ZM ZW BW NA SZ LS MG MU SC SN CI CM GA BF NE ML SO DJ ER GQ GM GN GW LR SL TG BJ CV CF TD MR ST KM MW RE YT EH",
    ],
    [
      "大洋洲(Oceania)",
      "AU NZ FJ PG SB VU WS TO KI TV NR PW FM MH NC PF GU AS MP CK NU",
    ],
  ];
  function code(value) {
    const flag = String(value).match(/[\u{1F1E6}-\u{1F1FF}]{2}/u)?.[0];
    if (flag)
      return [...flag]
        .map((c) => String.fromCharCode(c.codePointAt(0) - 0x1f1e6 + 65))
        .join("");
    const s = String(value).trim();
    return /^[A-Z]{2}$/.test(s)
      ? s
      : {
          美国: "US",
          中国: "CN",
          英国: "GB",
          波兰: "PL",
          法国: "FR",
          德国: "DE",
          "United States": "US",
          China: "CN",
          "United Kingdom": "GB",
          Poland: "PL",
          France: "FR",
          Germany: "DE",
        }[s];
  }
  function group(values) {
    const result = regions.map(([label]) => ({ label, values: [] })),
      other = { label: "其他地区", values: [] };
    for (const value of [...new Set(values)].filter(Boolean)) {
      const country = code(value),
        index = regions.findIndex(([, codes]) =>
          codes.split(" ").includes(country),
        );
      (index < 0 ? other : result[index]).values.push(value);
    }
    if (other.values.length) result.push(other);
    return result;
  }
  const api = { group };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LaiCustomerCountry = api;
})(typeof window !== "undefined" ? window : globalThis);
