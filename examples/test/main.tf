# data "aws_ami" "runner" {
#   most_recent = "true"

#   dynamic "filter" {
#     for_each = local.ami_filter
#     content {
#       name   = filter.key
#       values = filter.value
#     }
#   }

#   owners = var.ami_owners
# }

# lookup ami default owner Amazon, default ami Amazon linux

variable "ami_owners" {
  type    = list(string)
  default = ["amazon"]
}

variable "ami_filter" {
  type    = map(list(string))
  default = { name = ["al2023-ami-2023.*-kernel-6.*-x86_64"] }
}

data "aws_ami" "runner" {
  most_recent = "true"

  dynamic "filter" {
    for_each = var.ami_filter
    content {
      name   = filter.key
      values = filter.value
    }
  }

  owners = var.ami_owners
}

output "ami_id" {
  value = data.aws_ami.runner
}
