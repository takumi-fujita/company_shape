"""テスト用の XBRL インスタンス文書とラベルリンクベースを組み立てる。

EDINET の実物と同じ構造（xbrli:context の period / explicitMember、
円単位の金額、ラベルリンクベースでのセグメント名）を最小限で再現する。
"""
import io
import zipfile

NS = (
    'xmlns:xbrli="http://www.xbrl.org/2003/instance" '
    'xmlns:xbrldi="http://xbrl.org/2006/xbrldi" '
    'xmlns:link="http://www.xbrl.org/2003/linkbase" '
    'xmlns:xlink="http://www.w3.org/1999/xlink" '
    'xmlns:jpdei_cor="http://disclosure.edinet-fsa.go.jp/taxonomy/jpdei/2013-08-31/jpdei_cor" '
    'xmlns:jpcrp_cor="http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2023-12-01/jpcrp_cor" '
    'xmlns:jppfs_cor="http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2023-12-01/jppfs_cor" '
    'xmlns:local="http://disclosure.edinet-fsa.go.jp/jpcrp030000-asr_E01234-000"'
)


def _context(cid, start=None, end=None, instant=None, members=()):
    period = (
        "<xbrli:instant>%s</xbrli:instant>" % instant
        if instant
        else "<xbrli:startDate>%s</xbrli:startDate><xbrli:endDate>%s</xbrli:endDate>" % (start, end)
    )
    scenario = ""
    if members:
        dims = "".join(
            '<xbrldi:explicitMember dimension="local:%sAxis">%s</xbrldi:explicitMember>'
            % ("Segment" if "Member" in m else "Basis", m)
            for m in members
        )
        scenario = "<xbrli:scenario>%s</xbrli:scenario>" % dims
    return (
        '<xbrli:context id="%s">'
        "<xbrli:entity><xbrli:identifier scheme=\"x\">E01234</xbrli:identifier></xbrli:entity>"
        "<xbrli:period>%s</xbrli:period>%s"
        "</xbrli:context>" % (cid, period, scenario)
    )


def build_instance(
    edinet_code="E01234",
    fiscal_year_end="2026-03-31",
    consolidated=True,
    revenues=(9000, 9600, 10200, 11000, 12000),   # 百万円で指定（内部で円に直す）
    operating_profits=(450, 500, 560, 620, 700),
    employees=(280, 290, 300, 306, 312),
    cash=2180,
    avg_salary_yen=6480000,
    tenure_years="5",
    tenure_months="10",
    segments=(("Core", 300), ("Related", 230), ("Maintenance", 170)),
    include_totals=True,
    with_salary=True,
):
    """5 期分の主要指標を持つインスタンス文書を作る。金額の引数は百万円。"""
    year = int(fiscal_year_end[0:4])
    ends = ["%d%s" % (year - back, fiscal_year_end[4:]) for back in range(4, -1, -1)]
    starts = ["%d-04-01" % (int(e[0:4]) - 1) for e in ends]

    ctx = ['<xbrli:context id="FilingDateInstant"><xbrli:entity><xbrli:identifier scheme="x">E01234</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-06-26</xbrli:instant></xbrli:period></xbrli:context>']
    facts = []

    labels = {0: "Prior4Year", 1: "Prior3Year", 2: "Prior2Year", 3: "Prior1Year", 4: "CurrentYear"}
    for i, end in enumerate(ends):
        base = labels[i]
        ctx.append(_context(base + "Duration", start=starts[i], end=end))
        ctx.append(_context(base + "Instant", instant=end))
        ctx.append(_context(base + "Duration_NonConsolidatedMember", start=starts[i], end=end,
                            members=("local:NonConsolidatedMember",)))
        ctx.append(_context(base + "Instant_NonConsolidatedMember", instant=end,
                            members=("local:NonConsolidatedMember",)))

        facts.append(
            '<jpcrp_cor:NetSalesSummaryOfBusinessResults contextRef="%sDuration" unitRef="JPY" decimals="-6">%d</jpcrp_cor:NetSalesSummaryOfBusinessResults>'
            % (base, revenues[i] * 1_000_000)
        )
        facts.append(
            '<jpcrp_cor:NumberOfEmployees contextRef="%sInstant" unitRef="pure" decimals="0">%d</jpcrp_cor:NumberOfEmployees>'
            % (base, employees[i])
        )

    # 営業利益は本表にしかないので当期と前期のみ
    for i in (3, 4):
        facts.append(
            '<jppfs_cor:OperatingIncome contextRef="%sDuration" unitRef="JPY" decimals="-6">%d</jppfs_cor:OperatingIncome>'
            % (labels[i], operating_profits[i] * 1_000_000)
        )

    facts.append(
        '<jppfs_cor:CashAndDeposits contextRef="CurrentYearInstant" unitRef="JPY" decimals="-6">%d</jppfs_cor:CashAndDeposits>'
        % (cash * 1_000_000)
    )

    # 従業員の状況（提出会社＝単体コンテキスト）
    if with_salary:
        facts.append(
            '<jpcrp_cor:AverageAnnualSalaryInformationAboutReportingCompanyInformationAboutEmployees '
            'contextRef="CurrentYearInstant_NonConsolidatedMember" unitRef="JPY" decimals="0">%d'
            '</jpcrp_cor:AverageAnnualSalaryInformationAboutReportingCompanyInformationAboutEmployees>'
            % avg_salary_yen
        )
    if tenure_years is not None:
        facts.append(
            '<jpcrp_cor:AverageLengthOfServiceYearsInformationAboutReportingCompanyInformationAboutEmployees '
            'contextRef="CurrentYearInstant_NonConsolidatedMember" unitRef="pure" decimals="0">%s'
            '</jpcrp_cor:AverageLengthOfServiceYearsInformationAboutReportingCompanyInformationAboutEmployees>'
            % tenure_years
        )
    if tenure_months is not None:
        facts.append(
            '<jpcrp_cor:AverageLengthOfServiceMonthsInformationAboutReportingCompanyInformationAboutEmployees '
            'contextRef="CurrentYearInstant_NonConsolidatedMember" unitRef="pure" decimals="0">%s'
            '</jpcrp_cor:AverageLengthOfServiceMonthsInformationAboutReportingCompanyInformationAboutEmployees>'
            % tenure_months
        )

    # セグメント別営業利益（当期）
    seg_members = list(segments)
    if include_totals:
        seg_members = seg_members + [("Total", 700), ("Elimination", -30)]
    for name, value in seg_members:
        member = "local:%sReportableSegmentsMember" % name
        cid = "CurrentYearDuration_%sMember" % name
        ctx.append(_context(cid, start=starts[4], end=ends[4], members=(member,)))
        facts.append(
            '<jppfs_cor:OperatingIncomeLoss contextRef="%s" unitRef="JPY" decimals="-6">%d</jppfs_cor:OperatingIncomeLoss>'
            % (cid, value * 1_000_000)
        )

    dei = [
        '<jpdei_cor:EDINETCodeDEI contextRef="FilingDateInstant">%s</jpdei_cor:EDINETCodeDEI>' % edinet_code,
        '<jpdei_cor:FilerNameInJapaneseDEI contextRef="FilingDateInstant">株式会社テスト工業</jpdei_cor:FilerNameInJapaneseDEI>',
        '<jpdei_cor:SecurityCodeDEI contextRef="FilingDateInstant">12340</jpdei_cor:SecurityCodeDEI>',
        '<jpdei_cor:JapaneseCorporateNumberDEI contextRef="FilingDateInstant">1234567890123</jpdei_cor:JapaneseCorporateNumberDEI>',
        '<jpdei_cor:CurrentFiscalYearEndDateDEI contextRef="FilingDateInstant">%s</jpdei_cor:CurrentFiscalYearEndDateDEI>' % fiscal_year_end,
        '<jpdei_cor:WhetherConsolidatedFinancialStatementsArePreparedDEI contextRef="FilingDateInstant">%s</jpdei_cor:WhetherConsolidatedFinancialStatementsArePreparedDEI>'
        % ("true" if consolidated else "false"),
        '<jpcrp_cor:DescriptionOfBusinessTextBlock contextRef="CurrentYearDuration">'
        '&lt;p&gt;当社は&lt;b&gt;受託開発&lt;/b&gt;を主力としております。&lt;/p&gt;'
        "</jpcrp_cor:DescriptionOfBusinessTextBlock>",
    ]

    units = (
        '<xbrli:unit id="JPY"><xbrli:measure>iso4217:JPY</xbrli:measure></xbrli:unit>'
        '<xbrli:unit id="pure"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>'
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<xbrli:xbrl %s>%s%s%s%s</xbrli:xbrl>"
        % (NS, units, "".join(ctx), "".join(dei), "".join(facts))
    ).encode("utf-8")


SEGMENT_LABELS = {
    "Core": "主力事業",
    "Related": "関連サービス",
    "Maintenance": "保守・その他",
    "Total": "合計",
    "Elimination": "調整額",
}


def build_labels():
    locs, texts, arcs = [], [], []
    for key, ja in SEGMENT_LABELS.items():
        element_id = "jpcrp030000-asr_E01234-000_%sReportableSegmentsMember" % key
        locs.append(
            '<link:loc xlink:type="locator" xlink:href="x.xsd#%s" xlink:label="%s"/>' % (element_id, element_id)
        )
        texts.append(
            '<link:label xlink:type="resource" xlink:label="label_%s" '
            'xlink:role="http://www.xbrl.org/2003/role/label" xml:lang="ja">%s</link:label>'
            % (element_id, ja)
        )
        arcs.append(
            '<link:labelArc xlink:type="arc" xlink:from="%s" xlink:to="label_%s"/>' % (element_id, element_id)
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" '
        'xmlns:xlink="http://www.w3.org/1999/xlink">'
        "<link:labelLink>%s%s%s</link:labelLink></link:linkbase>"
        % ("".join(locs), "".join(texts), "".join(arcs))
    ).encode("utf-8")


def build_zip(**kwargs):
    """EDINET の書類 ZIP と同じ構造（PublicDoc / AuditDoc）で固める。"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("XBRL/PublicDoc/jpcrp030000-asr-001_E01234-000_2026-03-31_01_2026-06-26.xbrl",
                   build_instance(**kwargs))
        z.writestr("XBRL/PublicDoc/jpcrp030000-asr-001_E01234-000_2026-03-31_01_2026-06-26_lab.xml",
                   build_labels())
        # 監査報告書側は無視されること
        z.writestr("XBRL/AuditDoc/jpaud-aai-cc-001_E01234-000_2026-03-31_01_2026-06-26.xbrl",
                   b'<?xml version="1.0"?><xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance"/>')
    return buf.getvalue()
