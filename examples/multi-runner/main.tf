locals {
  environment = var.environment != null ? var.environment : "multi-runner"
  aws_region  = var.aws_region

  # Load runner configurations from Yaml files
  multi_runner_config_files = {
    for c in fileset("${path.module}/templates/runner-configs", "*.yaml") :

    trimsuffix(c, ".yaml") => yamldecode(file("${path.module}/templates/runner-configs/${c}"))
  }
  multi_runner_config = {
    for k, v in local.multi_runner_config_files :

    k => merge(
      v,
      {
        runner_config = merge(
          v.runner_config,
          {
            subnet_ids = lookup(v.runner_config, "subnet_ids", null) != null ? [module.base.vpc.private_subnets[0]] : null
            vpc_id     = lookup(v.runner_config, "vpc_id", null) != null ? module.base.vpc.vpc_id : null
          },
          { allow_list : try(v.allow_list, []) }
        )
      }
    )
  }
}

resource "random_id" "random" {
  byte_length = 20
}

module "base" {
  source = "../base"

  prefix     = local.environment
  aws_region = local.aws_region
}

module "runners" {
  source              = "../../modules/multi-runner"
  multi_runner_config = local.multi_runner_config
  #  Alternative to loading runner configuration from Yaml files is using static configuration:
  #  multi_runner_config = {
  #    "linux-x64" = {
  #      matcherConfig : {
  #        labelMatchers = [["self-hosted", "linux", "x64", "amazon"]]
  #        exactMatch    = false
  #      }
  #      delay_webhook_event = 0
  #      runner_config = {
  #        runner_os                       = "linux"
  #        runner_architecture             = "x64"
  #        runner_name_prefix              = "amazon-x64_"
  #        create_service_linked_role_spot = true
  #        enable_ssm_on_runners           = true
  #        instance_types                  = ["m5ad.large", "m5a.large"]
  #        runner_extra_labels             = ["amazon"]
  #        runners_maximum_count           = 1
  #        enable_ephemeral_runners        = true
  #        scale_down_schedule_expression  = "cron(* * * * ? *)"
  #      }
  #    }
  #  }
  aws_region                        = local.aws_region
  vpc_id                            = module.base.vpc.vpc_id
  subnet_ids                        = module.base.vpc.private_subnets
  runners_scale_up_lambda_timeout   = 60
  runners_scale_down_lambda_timeout = 60
  prefix                            = local.environment
  tags = {
    Project = "ProjectX"
  }
  github_app = {
    key_base64     = var.github_app.key_base64
    id             = var.github_app.id
    webhook_secret = random_id.random.hex
  }

  # Deploy webhook using the EventBridge
  eventbridge = {
    enable = true
    # adjust the allow events to only allow specific events, like workflow_job
    accept_events = ["workflow_job"]
  }

  # enable this section for tracing
  # tracing_config = {
  #   mode                  = "Active"
  #   capture_error         = true
  #   capture_http_requests = true
  # }
  # Assuming local build lambda's to use pre build ones, uncomment the lines below and download the
  # lambda zip files lambda_download
  # webhook_lambda_zip                = "../lambdas-download/webhook.zip"
  # runner_binaries_syncer_lambda_zip = "../lambdas-download/runner-binaries-syncer.zip"
  # runners_lambda_zip                = "../lambdas-download/runners.zip"

  # Enable debug logging for the lambda functions
  # log_level = "debug"

  # Enable to track the spot instance termination warning
  # instance_termination_watcher = {
  #   enable         = true
  # }

  # Enable metrics
  # metrics = {
  #   enable = true
  #   metric = {
  #     enable_github_app_rate_limit    = true
  #     enable_job_retry                = false
  #     enable_spot_termination_warning = true
  #   }
  # }
}

module "webhook_github_app" {
  source     = "../../modules/webhook-github-app"
  depends_on = [module.runners]

  github_app = {
    key_base64     = var.github_app.key_base64
    id             = var.github_app.id
    webhook_secret = random_id.random.hex
  }
  webhook_endpoint = module.runners.webhook.endpoint
}
