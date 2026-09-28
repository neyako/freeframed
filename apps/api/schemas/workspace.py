from pydantic import BaseModel, field_validator


class WorkspaceResponse(BaseModel):
    name: str
    logo_dark: str | None = None
    logo_light: str | None = None

    model_config = {"from_attributes": True}


class WorkspaceRename(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        name = v.strip()
        if not name or len(name) > 255:
            raise ValueError("name must be between 1 and 255 characters")
        return name
