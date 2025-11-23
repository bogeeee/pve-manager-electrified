package PVE::API2::Cluster::Jobs;

use strict;
use warnings;

use PVE::RESTHandler;
use PVE::CalendarEvent;

use PVE::API2::Jobs::RealmSync;

use base qw(PVE::RESTHandler);

__PACKAGE__->register_method({
    subclass => "PVE::API2::Jobs::RealmSync",
    path => 'realm-sync',
});

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    description => "Index for jobs related endpoints.",
    permissions => { user => 'all' },
    parameters => {
        additionalProperties => 0,
        properties => {},
    },
    returns => {
        type => 'array',
        description => 'Directory index.',
        items => {
            type => "object",
            properties => {
                subdir => {
                    type => 'string',
                    description => 'API sub-directory endpoint',
                },
            },
        },
        links => [{ rel => 'child', href => "{subdir}" }],
    },
    code => sub {
        return [
            { subdir => 'schedule-analyze' }, { subdir => 'realm-sync' },
        ];
    },
});

__PACKAGE__->register_method({
    name => 'schedule-analyze',
    path => 'schedule-analyze',
    method => 'GET',
    description => "Returns a list of future schedule runtimes.",
    permissions => { user => 'all' },
    parameters => {
        additionalProperties => 0,
        properties => {
            schedule => {
                description =>
                    "Job schedule. The format is a subset of `systemd` calendar events.",
                type => 'string',
                format => 'pve-calendar-event',
                maxLength => 128,
            },
            starttime => {
                description =>
                    "UNIX timestamp to start the calculation from. Defaults to the current time.",
                optional => 1,
                type => 'integer',
            },
            iterations => {
                description => "Number of event-iteration to simulate and return.",
                optional => 1,
                type => 'integer',
                minimum => 1,
                maximum => 100,
                default => 10,
            },
        },
    },
    returns => {
        type => 'array',
        description => 'An array of the next <iterations> events since <starttime>.',
        items => {
            type => 'object',
            properties => {
                timestamp => {
                    type => 'integer',
                    description => 'UNIX timestamp for the run.',
                },
                utc => {
                    type => 'string',
                    description => "UTC timestamp for the run.",
                },
            },
        },
    },
    code => sub {
        my ($param) = @_;

        my $starttime = $param->{starttime} // time();
        my $iterations = $param->{iterations} // 10;
        my $schedule = $param->{schedule};

        my $result = [];

        my $event = PVE::CalendarEvent::parse_calendar_event($schedule);

        for (my $count = 0; $count < $iterations; $count++) {
            my $next = PVE::CalendarEvent::compute_next_event($event, $starttime);
            last if !defined($next);
            push @$result,
                {
                    timestamp => $next,
                    utc => scalar(gmtime($next)),
                };
            $starttime = $next;
        }

        return $result;
    },
});

1;
