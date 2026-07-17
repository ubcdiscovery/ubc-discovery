from app.config import Settings


def test_database_ssl_preserves_required_tls_by_default():
    assert Settings(_env_file=None).database_ssl == "require"


def test_database_ssl_can_be_disabled_for_isolated_beta_database():
    assert Settings(_env_file=None, database_ssl="disable").database_ssl == "disable"
