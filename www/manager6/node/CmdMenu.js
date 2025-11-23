Ext.define('PVE.node.CmdMenu', {
    extend: 'Ext.menu.Menu',
    xtype: 'nodeCmdMenu',

    showSeparator: false,

    items: [
        {
            text: gettext('Create VM'),
            itemId: 'createvm',
            iconCls: 'fa fa-desktop',
            handler: function () {
                Ext.create('PVE.qemu.CreateWizard', {
                    nodename: this.up('menu').nodename,
                    autoShow: true,
                });
            },
        },
        {
            text: gettext('Create CT'),
            itemId: 'createct',
            iconCls: 'fa fa-cube',
            handler: function () {
                Ext.create('PVE.lxc.CreateWizard', {
                    nodename: this.up('menu').nodename,
                    autoShow: true,
                });
            },
        },
        { xtype: 'menuseparator' },
        {
            text: gettext('Bulk Start'),
            itemId: 'bulkstart',
            iconCls: 'fa fa-fw fa-play',
            handler: function () {
                Ext.create('PVE.window.BulkAction', {
                    nodename: this.up('menu').nodename,
                    title: gettext('Bulk Start'),
                    btnText: gettext('Start'),
                    action: 'startall',
                    autoShow: true,
                });
            },
        },
        {
            text: gettext('Bulk Shutdown'),
            itemId: 'bulkstop',
            iconCls: 'fa fa-fw fa-stop',
            handler: function () {
                Ext.create('PVE.window.BulkAction', {
                    nodename: this.up('menu').nodename,
                    title: gettext('Bulk Shutdown'),
                    btnText: gettext('Shutdown'),
                    action: 'stopall',
                    autoShow: true,
                });
            },
        },
        {
            text: gettext('Bulk Suspend'),
            itemId: 'bulksuspend',
            iconCls: 'fa fa-fw fa-download',
            handler: function () {
                Ext.create('PVE.window.BulkAction', {
                    nodename: this.up('menu').nodename,
                    title: gettext('Bulk Suspend'),
                    btnText: gettext('Suspend'),
                    action: 'suspendall',
                    autoShow: true,
                });
            },
        },
        {
            text: gettext('Bulk Migrate'),
            itemId: 'bulkmigrate',
            iconCls: 'fa fa-fw fa-send-o',
            handler: function () {
                Ext.create('PVE.window.BulkAction', {
                    nodename: this.up('menu').nodename,
                    title: gettext('Bulk Migrate'),
                    btnText: gettext('Migrate'),
                    action: 'migrateall',
                    autoShow: true,
                });
            },
        },
        { xtype: 'menuseparator' },
        {
            text: gettext('Shell'),
            itemId: 'shell',
            iconCls: 'fa fa-fw fa-terminal',
            handler: function () {
                let nodename = this.up('menu').nodename;
                PVE.Utils.openDefaultConsoleWindow(true, 'shell', undefined, nodename, undefined);
            },
        },
        { xtype: 'menuseparator' },
        {
            text: gettext('Wake-on-LAN'),
            itemId: 'wakeonlan',
            iconCls: 'fa fa-fw fa-power-off',
            handler: function () {
                let nodename = this.up('menu').nodename;
                Proxmox.Utils.API2Request({
                    url: `/nodes/${nodename}/wakeonlan`,
                    method: 'POST',
                    failure: (response, opts) =>
                        Ext.Msg.alert(gettext('Error'), response.htmlStatus),
                    success: function (response, opts) {
                        Ext.Msg.show({
                            title: 'Success',
                            icon: Ext.Msg.INFO,
                            msg: Ext.String.format(
                                gettext("Wake on LAN packet send for '{0}': '{1}'"),
                                nodename,
                                response.result.data,
                            ),
                        });
                    },
                });
            },
        },
    ],

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            throw 'no nodename specified';
        }

        me.title = gettext('Node') + " '" + me.nodename + "'";
        me.callParent();

        let caps = Ext.state.Manager.get('GuiCap');

        if (!caps.vms['VM.Allocate']) {
            me.getComponent('createct').setDisabled(true);
            me.getComponent('createvm').setDisabled(true);
        }
        if (!caps.vms['VM.Migrate']) {
            me.getComponent('bulkmigrate').setDisabled(true);
        }
        if (!caps.vms['VM.PowerMgmt']) {
            me.getComponent('bulkstart').setDisabled(true);
            me.getComponent('bulkstop').setDisabled(true);
            me.getComponent('bulksuspend').setDisabled(true);
        }
        if (!caps.nodes['Sys.PowerMgmt']) {
            me.getComponent('wakeonlan').setDisabled(true);
        }
        if (!caps.nodes['Sys.Console']) {
            me.getComponent('shell').setDisabled(true);
        }
        if (me.pveSelNode.data.running) {
            me.getComponent('wakeonlan').setDisabled(true);
        }

        if (PVE.Utils.isStandaloneNode()) {
            me.getComponent('bulkmigrate').setVisible(false);
        }
    },
});
