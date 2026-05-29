import pytest
from unittest.mock import patch, MagicMock
from data.compute_scores import (
    convert_params, score_range, score_chart, score_final,
    fetch_latest_per_commune,
)


def test_convert_ca_hardness():
    p = convert_params(dict(calcium=27.2, tac=None, conductivite=None, ph=None, na=None, cl=None, cl2=None))
    assert abs(p["ca_hardness"] - 67.9) < 0.1
    assert p["alkalinity"] is None

def test_convert_alkalinity():
    p = convert_params(dict(calcium=None, tac=5.5, conductivite=None, ph=None, na=None, cl=None, cl2=None))
    assert abs(p["alkalinity"] - 55.0) < 0.1

def test_convert_tds():
    p = convert_params(dict(calcium=None, tac=None, conductivite=200, ph=None, na=None, cl=None, cl2=None))
    assert abs(p["tds"] - 130.0) < 0.1

def test_score_range_within():
    assert score_range(7.0, 6.5, 7.5, 0, 14) == 1.0

def test_score_range_above():
    s = score_range(8.0, 6.5, 7.5, 0, 14)
    assert 0 < s < 1.0

def test_score_range_at_max():
    assert score_range(14, 6.5, 7.5, 0, 14) == 0.0

def test_score_range_none():
    assert score_range(None, 6.5, 7.5, 0, 14) is None

def test_score_chart_ideal():
    assert score_chart(68.0, 55.0) > 0.99

def test_score_chart_paris():
    assert score_chart(244.0, 209.0) < 0.20

def test_score_chart_1d_ca():
    assert score_chart(68.0, None) > 0.98

def test_score_chart_1d_alk():
    assert score_chart(None, 55.0) > 0.98

def test_score_chart_both_none():
    assert score_chart(None, None) is None

def test_score_final_annecy():
    p = dict(ca_hardness=85.0, alkalinity=80.0, ph=7.2, tds=142.0, na=8.0, cl=18.0, cl2=0.08)
    s = score_final(p)
    assert 0.75 <= s <= 0.95

def test_score_final_no_axes_returns_none():
    p = dict(ca_hardness=None, alkalinity=None, ph=7.0, tds=150.0, na=10.0, cl=20.0, cl2=0.0)
    assert score_final(p) is None

def test_score_final_clamped_to_one():
    """Negative cl2 must not push score above 1.0 — mirrors the JS fix."""
    p = dict(ca_hardness=68.0, alkalinity=55.0, ph=7.0, tds=150.0, na=10.0, cl=20.0, cl2=-1.0)
    s = score_final(p)
    assert s is not None and 0.0 <= s <= 1.0

@patch("data.compute_scores.requests.get")
def test_fetch_latest_per_commune_basic(mock_get):
    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "count": 2,
        "data": [
            {"code_commune": "74010", "nom_commune": "Annecy",   "resultat_numerique": 34.0, "date_prelevement": "2026-03-12"},
            {"code_commune": "38185", "nom_commune": "Grenoble", "resultat_numerique": 30.0, "date_prelevement": "2026-02-01"},
        ],
    }
    mock_get.return_value = mock_resp
    result = fetch_latest_per_commune("1374")
    assert result["74010"]["value"] == 34.0
    assert result["38185"]["nom"] == "Grenoble"

@patch("data.compute_scores.requests.get")
def test_fetch_deduplicates_keeps_first_desc(mock_get):
    """Sorted desc: first occurrence per commune_code = most recent; duplicate must be discarded."""
    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "count": 2,
        "data": [
            {"code_commune": "74010", "nom_commune": "Annecy", "resultat_numerique": 34.0, "date_prelevement": "2026-03-12"},
            {"code_commune": "74010", "nom_commune": "Annecy", "resultat_numerique": 28.0, "date_prelevement": "2025-03-12"},
        ],
    }
    mock_get.return_value = mock_resp
    result = fetch_latest_per_commune("1374")
    assert len(result) == 1
    assert result["74010"]["value"] == 34.0
