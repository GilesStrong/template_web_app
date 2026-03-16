make_route_id:
	@uv run python -c "import nanoid; print(nanoid.generate())" 

be_tests:
	@cd app && uv run python manage.py test -v 2

fe_tests:
	@cd frontend && bun run test --run
	
fe_lint:
	@cd frontend && bun run lint

fe_e2e_tests:
	@docker compose exec frontend bun run e2e

start_prod:
	@docker compose --project-name myapp_prod --env-file .env.prod -f docker-compose.prod.yml up -d --build

stop_prod:
	@docker compose --project-name myapp_prod --env-file .env.prod -f docker-compose.prod.yml down

recreate_prod_service ${service}:
	@docker compose --project-name myapp_prod --env-file .env.prod -f docker-compose.prod.yml up -d --force-recreate ${service}

check_logs_prod ${service}:
	@docker compose --project-name myapp_prod --env-file .env.prod -f docker-compose.prod.yml logs --tail=200 ${service}
