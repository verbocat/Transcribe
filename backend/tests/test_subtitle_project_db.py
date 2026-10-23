"""Subtitle project save/list/load against a throwaway SQLite database (never the cloud one)."""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.main as main
from types import SimpleNamespace
from app.db import Base


ME = SimpleNamespace(id="user-a", is_admin=False)
OTHER = SimpleNamespace(id="user-b", is_admin=False)
ADMIN = SimpleNamespace(id="boss", is_admin=True)


@pytest.fixture
def sqlite_session(monkeypatch, tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'subtitle_projects.db'}")
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(main, "get_db_session", sessionmaker(bind=engine))
    yield
    engine.dispose()


def _payload(**overrides):
    project = {
        "video_id": "vid12345",
        "filename": "episode.mp4",
        "language": "hi",
        "content_type": "children",
        "metadata": {"duration": 42.5, "frame_rate": 25.0, "width": 1920, "height": 1080, "codec": "h264"},
        "compliance_score": 87.5,
        "total_errors": 2,
        "total_warnings": 3,
        "shot_changes": [1.2, 7.8],
        "events": [
            {"event_id": 2, "start_time": 3.0, "end_time": 5.0, "duration": 2.0, "text": "दूसरा",
             "qc_errors": [{"rule": "cps", "severity": "warning"}], "is_valid": False},
            {"event_id": 1, "start_time": 0.5, "end_time": 2.5, "duration": 2.0, "text": "पहला",
             "qc_errors": [], "is_valid": True},
        ],
    }
    project.update(overrides)
    return {"project": project}


def test_new_project_saves_and_reads_back(sqlite_session):
    assert main._save_subtitle_project_to_db(_payload(), ME) == "vid12345"

    listed = main._list_subtitle_projects_from_db(ME)
    assert len(listed) == 1
    assert listed[0]["id"] == "vid12345"
    assert listed[0]["duration"] == 42.5
    assert listed[0]["event_count"] == 2

    proj = main._get_subtitle_project_details_from_db("vid12345", ME)
    assert proj["filename"] == "episode.mp4"
    assert proj["language"] == "hi"
    assert proj["content_type"] == "children"
    assert proj["duration"] == 42.5
    assert proj["metadata"] == {"duration": 42.5, "frame_rate": 25.0, "width": 1920, "height": 1080}
    assert (proj["compliance_score"], proj["total_errors"], proj["total_warnings"]) == (87.5, 2, 3)
    assert proj["shot_changes"] == [1.2, 7.8]
    assert [e["event_id"] for e in proj["events"]] == [1, 2]
    assert proj["events"][0]["text"] == "पहला"
    assert proj["events"][1]["qc_errors"] == [{"rule": "cps", "severity": "warning"}]
    assert proj["events"][1]["is_valid"] is False


def test_resave_replaces_events(sqlite_session):
    main._save_subtitle_project_to_db(_payload(), ME)
    one_event = [{"event_id": 1, "start_time": 0.0, "end_time": 1.0, "duration": 1.0, "text": "only"}]
    main._save_subtitle_project_to_db(_payload(filename="renamed.mp4", total_errors=0, events=one_event), ME)

    proj = main._get_subtitle_project_details_from_db("vid12345", ME)
    assert proj["filename"] == "renamed.mp4"
    assert proj["total_errors"] == 0
    assert [e["text"] for e in proj["events"]] == ["only"]
    assert main._list_subtitle_projects_from_db(ME)[0]["event_count"] == 1


def test_projects_are_private_to_their_owner(sqlite_session):
    main._save_subtitle_project_to_db(_payload(), ME)

    assert main._list_subtitle_projects_from_db(OTHER) == []
    assert main._get_subtitle_project_details_from_db("vid12345", OTHER) is None
    assert main._delete_subtitle_project_from_db("vid12345", OTHER) is False
    with pytest.raises(PermissionError):
        main._save_subtitle_project_to_db(_payload(filename="hijack.mp4"), OTHER)

    assert main._list_subtitle_projects_from_db(ADMIN) == []  # an admin's own list: only their projects
    assert main._get_subtitle_project_details_from_db("vid12345", ADMIN)["filename"] == "episode.mp4"
    assert main._delete_subtitle_project_from_db("nope", ADMIN) is False
    assert main._get_subtitle_project_details_from_db("vid12345", ME)["filename"] == "episode.mp4"
    assert main._delete_subtitle_project_from_db("vid12345", ME) is True
    assert main._list_subtitle_projects_from_db(ME) == []


def test_projects_saved_before_owners_existed_are_admin_only(sqlite_session):
    main._save_subtitle_project_to_db(_payload(), ME)
    session = main.get_db_session()
    session.query(main.DBSubtitleProject).update({"owner_id": None})
    session.commit()
    session.close()

    assert main._list_subtitle_projects_from_db(OTHER) == []
    assert main._get_subtitle_project_details_from_db("vid12345", OTHER) is None
    assert len(main._list_subtitle_projects_from_db(ADMIN)) == 1
