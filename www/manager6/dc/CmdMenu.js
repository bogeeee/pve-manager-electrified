Ext.define('PVE.dc.CmdMenu', {
    extend: 'Ext.menu.Menu',
    xtype: 'datacenterCmdMenu',

    showSeparator: false,

    extraHandlerArgs: {},

    items: [
        {
            text: gettext('Bulk Start'),
            itemId: 'bulkstart',
            iconCls: 'fa fa-fw fa-play',
            handler: function () {
                let extraArgs = this.up('datacenterCmdMenu').extraHandlerArgs ?? {};
                Ext.create('PVE.window.BulkAction', {
                    autoShow: true,
                    vmsAsArray: true,
                    title: gettext('Bulk Start'),
                    btnText: gettext('Start'),
                    action: 'start',
                    ...extraArgs,
                });
            },
        },
        {
            text: gettext('Bulk Shutdown'),
            itemId: 'bulkstop',
            iconCls: 'fa fa-fw fa-stop',
            handler: function () {
                let extraArgs = this.up('datacenterCmdMenu').extraHandlerArgs ?? {};
                Ext.create('PVE.window.BulkAction', {
                    autoShow: true,
                    vmsAsArray: true,
                    title: gettext('Bulk Shutdown'),
                    btnText: gettext('Shutdown'),
                    action: 'shutdown',
                    ...extraArgs,
                });
            },
        },
        {
            text: gettext('Bulk Suspend'),
            itemId: 'bulksuspend',
            iconCls: 'fa fa-fw fa-download',
            handler: function () {
                let extraArgs = this.up('datacenterCmdMenu').extraHandlerArgs ?? {};
                Ext.create('PVE.window.BulkAction', {
                    autoShow: true,
                    vmsAsArray: true,
                    title: gettext('Bulk Suspend'),
                    btnText: gettext('Suspend'),
                    action: 'suspend',
                    ...extraArgs,
                });
            },
        },
        {
            text: gettext('Bulk Migrate'),
            itemId: 'bulkmigrate',
            iconCls: 'fa fa-fw fa-send-o',
            handler: function () {
                let extraArgs = this.up('datacenterCmdMenu').extraHandlerArgs ?? {};
                Ext.create('PVE.window.BulkAction', {
                    autoShow: true,
                    vmsAsArray: true,
                    title: gettext('Bulk Migrate'),
                    btnText: gettext('Migrate'),
                    action: 'migrate',
                    ...extraArgs,
                });
            },
        },
    ],

    initComponent: function () {
        let me = this;

        if (!me.title) {
            me.title = gettext('Datacenter');
            if (PVE.ClusterName?.length) {
                me.title += ` (${PVE.ClusterName})`;
                me.minWidth = 220;
            }
        }

        me.items = window.electrifiedApp._addDatacenterElectrifiedMenuItems(me.items);

        me.callParent();

        let caps = Ext.state.Manager.get('GuiCap');

        if (!caps.vms['VM.Migrate']) {
            me.getComponent('bulkmigrate').setDisabled(true);
        }
        if (!caps.vms['VM.PowerMgmt']) {
            me.getComponent('bulkstart').setDisabled(true);
            me.getComponent('bulkstop').setDisabled(true);
            me.getComponent('bulksuspend').setDisabled(true);
        }
        if (PVE.Utils.isStandaloneNode()) {
            me.getComponent('bulkmigrate').setVisible(false);
        }
    },
});

Ext.define('PVE.dc.TagCmdMenu', {
    extend: 'PVE.dc.CmdMenu',
    xtype: 'tagCmdMenu',

    minWidth: 220,

    initComponent: function () {
        let me = this;

        if (!me.tag) {
            throw 'no tag specified';
        }

        me.title = `${gettext('Tag')} '${me.tag}'`;
        if (PVE.ClusterName?.length) {
            me.title += ` (${me.nodename})`;
        }

        me.extraHandlerArgs = {
            prefilterIncludeTag: me.tag,
        };

        me.callParent();
    },
});
