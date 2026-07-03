Ext.define('PVE.ha.Status', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveHAStatus',

    onlineHelp: 'chapter_ha_manager',
    layout: {
        type: 'vbox',
        align: 'stretch',
    },

    viewModel: {
        data: {
            haDisarmed: false,
        },
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        handleDisarmButton: function (menuItem) {
            let me = this;
            let view = me.getView();

            let warn = Ext.String.format(
                gettext("Are you sure you want to disarm HA with resource mode '{0}'?"),
                menuItem.text,
            );

            let details = gettext(
                'While disarmed, HA does not protect your services. Failures during this period are not automatically recovered.',
            );

            Ext.Msg.confirm(
                gettext('Confirm'),
                warn + '<br><br>' + menuItem.details + '<br><br>' + details,
                function (btn) {
                    if (btn !== 'yes') {
                        return;
                    }
                    Proxmox.Utils.API2Request({
                        url: '/cluster/ha/status/disarm-ha',
                        params: { 'resource-mode': menuItem.mode },
                        method: 'POST',
                        success: function () {
                            let sv = view.query('pveHAStatusView')[0];
                            sv.isDisarmedPendingState = true;
                            sv.setPending(true);
                        },
                        failure: (response) => Ext.Msg.alert(gettext('Error'), response.htmlStatus),
                    });
                },
            );
        },

        openCRSOptions: function () {
            Ext.create('PVE.form.CRSOptions', {
                autoShow: true,
                autoLoad: true,
            });
        },

        handleArmButton: function () {
            let me = this;
            let view = me.getView();

            Ext.Msg.confirm(
                gettext('Confirm'),
                gettext('Are you sure you want to arm HA?'),
                function (btn) {
                    if (btn !== 'yes') {
                        return;
                    }
                    Proxmox.Utils.API2Request({
                        url: '/cluster/ha/status/arm-ha',
                        method: 'POST',
                        success: function () {
                            let sv = view.query('pveHAStatusView')[0];
                            sv.isDisarmedPendingState = false;
                            sv.setPending(true);
                        },
                        failure: (response) => Ext.Msg.alert(gettext('Error'), response.htmlStatus),
                    });
                },
            );
        },
    },

    tbar: [
        {
            text: gettext('Arm HA'),
            iconCls: 'fa fa-link',
            bind: {
                disabled: '{!haDisarmed}',
            },
            handler: 'handleArmButton',
        },
        {
            text: gettext('Disarm HA'),
            iconCls: 'fa fa-unlink',
            bind: {
                disabled: '{haDisarmed}',
            },
            menu: [
                {
                    text: gettext('Freeze'),
                    details: gettext(
                        'This will freeze all services allowing no change to their operational state.',
                    ),
                    iconCls: 'fa fa-snowflake-o',
                    mode: 'freeze',
                    handler: 'handleDisarmButton',
                },
                {
                    text: gettext('Ignore'),
                    details: gettext(
                        'The HA stack will be completely bypassed when the operational state of a service changes.',
                    ),
                    iconCls: 'fa fa-eye-slash',
                    mode: 'ignore',
                    handler: 'handleDisarmButton',
                },
            ],
        },
        '->',
        {
            text: gettext('CRS Settings'),
            iconCls: 'fa fa-cogs',
            tooltip: gettext('Cluster Resource Scheduling, configured under Datacenter > Options'),
            handler: 'openCRSOptions',
        },
    ],

    initComponent: function () {
        var me = this;

        me.rstore = Ext.create('Proxmox.data.ObjectStore', {
            interval: me.interval,
            model: 'pve-ha-status',
            storeid: 'pve-store-' + ++Ext.idSeed,
            groupField: 'type',
            proxy: {
                type: 'proxmox',
                url: '/api2/json/cluster/ha/status/current',
            },
        });

        me.items = [
            {
                xtype: 'pveHAStatusView',
                title: gettext('Status'),
                rstore: me.rstore,
                border: 0,
                collapsible: true,
                padding: '0 0 20 0',
                listeners: {
                    hastatuschange: function (isDisarmed) {
                        let vm = me.getViewModel();
                        let sv = me.query('pveHAStatusView')[0];

                        vm.set('haDisarmed', isDisarmed);

                        if (sv.isDisarmedPendingState === null) {
                            return;
                        }

                        if (isDisarmed === sv.isDisarmedPendingState) {
                            sv.setPending(false);
                            sv.isDisarmedPendingState = null;
                        }
                    },
                },
            },
            {
                xtype: 'pveHAResourcesView',
                flex: 1,
                collapsible: true,
                title: gettext('Resources'),
                border: 0,
                rstore: me.rstore,
            },
        ];

        me.callParent();
        me.on('activate', me.rstore.startUpdate);
    },
});
